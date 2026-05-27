import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkRateLimit } from './ratelimit.js';
import { logger as rootLogger } from '../logger.js';

const logger = rootLogger.child({ component: 'browser' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const COOKIES_PATH = path.join(__dirname, '../../cookies.json');

// Random delay helper to simulate human behavior
function randomDelay(min = 2000, max = 5000) {
  return new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));
}

// Human-like mouse movement
async function humanLikeDelay(page) {
  // Random delay between 1.5-4 seconds
  await randomDelay(1500, 4000);

  // Occasionally move mouse to simulate human behavior
  if (Math.random() > 0.5) {
    const x = Math.floor(Math.random() * 800);
    const y = Math.floor(Math.random() * 600);
    await page.mouse.move(x, y);
  }
}

export async function getBrowser(options = {}) {
  // Allow explicit headless override via options
  const headless = options.headless !== undefined ? options.headless : true;

  const browser = await puppeteer.launch({
    headless: headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-web-security'
    ]
  });

  return browser;
}

export async function loadCookies(page) {
  try {
    const cookiesString = await fs.readFile(COOKIES_PATH, 'utf-8');
    const cookies = JSON.parse(cookiesString);
    await page.setCookie(...cookies);
    return true;
  } catch (error) {
    return false;
  }
}

export async function saveCookies(page) {
  const cookies = await page.cookies();
  await fs.writeFile(COOKIES_PATH, JSON.stringify(cookies, null, 2));
}

export async function loginToLinkedIn() {
  const browser = await getBrowser({ headless: false });
  const page = await browser.newPage();

  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  await page.goto('https://www.linkedin.com/login', { waitUntil: 'networkidle2' });

  logger.info('Please log in to LinkedIn in the browser window — waiting for login (auto-closes on success)');

  // Poll for successful login instead of waiting for navigation
  const startTime = Date.now();
  const timeout = 300000; // 5 minutes
  let isLoggedIn = false;

  while (Date.now() - startTime < timeout) {
    const currentUrl = page.url();

    // Only treat known post-auth URLs as success. Pages like /checkpoint,
    // /uas/two-step-verification, and /authwall also lack the session_key
    // input and don't contain "/login" — so a form-absence fallback here
    // races the 2FA flow and closes the browser mid-verification.
    isLoggedIn = currentUrl.includes('linkedin.com/feed') ||
                 currentUrl.includes('linkedin.com/in/') ||
                 currentUrl.includes('linkedin.com/mynetwork') ||
                 currentUrl.includes('linkedin.com/jobs') ||
                 currentUrl.includes('linkedin.com/messaging');

    if (isLoggedIn) {
      logger.info({ event: 'login.detected' }, 'login detected — saving cookies');
      break;
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  if (!isLoggedIn) {
    await browser.close();
    throw new Error('Login timed out - please try again');
  }

  await saveCookies(page);
  await browser.close();

  return true;
}

export async function getLinkedInPage(browser) {
  logger.debug('creating new page');
  const page = await browser.newPage();

  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  await page.setViewport({
    width: 1920 + Math.floor(Math.random() * 100),
    height: 1080 + Math.floor(Math.random() * 100)
  });

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    window.chrome = { runtime: {} };
  });

  logger.debug('loading cookies');
  const cookiesLoaded = await loadCookies(page);

  if (!cookiesLoaded) {
    throw new Error('Not logged in to LinkedIn. Please run: research login');
  }

  logger.debug({ event: 'cookies.loaded' }, 'cookies loaded successfully');
  return page;
}

export async function scrapeLinkedInProfile(url, options = {}) {
  // Validate session before making request
  const { validateSession, relogin } = await import('./session.js');
  const isValid = await validateSession();

  if (!isValid) {
    if (options.autoRelogin) {
      logger.info({ event: 'session.invalid' }, 'session invalid — attempting auto-relogin');
      const loginSuccess = await relogin();
      if (!loginSuccess) {
        throw new Error('Auto-relogin failed. Please run: node src/index.js login');
      }
    } else {
      throw new Error('LinkedIn session expired. Please run: node src/index.js login');
    }
  }

  // Check and enforce rate limiting
  await checkRateLimit();

  logger.info({ event: 'profile.scrape.start', url }, 'scraping LinkedIn profile');
  const browser = await getBrowser({ headless: options.headless });
  const page = await getLinkedInPage(browser);

  try {
    // Human-like delay before navigation
    await randomDelay(1000, 2500);

    logger.debug({ event: 'profile.navigate', url }, 'navigating to profile');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Human-like delay after page load
    await humanLikeDelay(page);

    // Scroll down slowly to load lazy content
    logger.debug('scrolling to load all content');
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
          // Scroll to bottom to load everything
          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });

    // Wait a bit for lazy-loaded content
    await randomDelay(2000, 3000);

    logger.debug('extracting profile data for LLM parsing');

    // Extract raw text content - let LLM parse it
    const profileData = await page.evaluate(() => {
      const main = document.querySelector('main') || document.body;

      // Get structured sections
      const sections = {
        header: null,
        about: null,
        experience: null,
        education: null,
        skills: null,
        certifications: null
      };

      // Try to find each section by common patterns
      const allSections = main.querySelectorAll('section');

      allSections.forEach(section => {
        const sectionText = section.innerText?.toLowerCase() || '';
        const sectionId = section.id?.toLowerCase() || '';

        if (!sections.header && (sectionId.includes('profile') || section.querySelector('h1'))) {
          sections.header = section.innerText;
        }
        else if (!sections.about && (sectionText.includes('about') || sectionId.includes('about'))) {
          sections.about = section.innerText;
        }
        else if (!sections.experience && (sectionText.includes('experience') || sectionId.includes('experience'))) {
          sections.experience = section.innerText;
        }
        else if (!sections.education && (sectionText.includes('education') || sectionId.includes('education'))) {
          sections.education = section.innerText;
        }
        else if (!sections.skills && (sectionText.includes('skills') || sectionId.includes('skill'))) {
          sections.skills = section.innerText;
        }
        else if (!sections.certifications && (sectionText.includes('license') || sectionText.includes('certification'))) {
          sections.certifications = section.innerText;
        }
      });

      // Pull a best-guess location from the header. The LinkedIn profile header
      // text typically looks like:
      //   Name
      //   Headline
      //   Greater Phoenix Area · 500+ connections
      // The location is either inline before the "·" separator, or the line
      // directly above the connections count.
      let location = null;
      if (sections.header) {
        const lines = sections.header.split('\n').map(l => l.trim()).filter(Boolean);
        const connectionsRegex = /\d+\+?\s*(connections?|followers?|mutual)/i;
        for (let i = 0; i < lines.length; i++) {
          if (connectionsRegex.test(lines[i])) {
            const inline = lines[i].split('·').map(s => s.trim())
              .find(s => s && !connectionsRegex.test(s));
            if (inline) { location = inline; break; }
            if (i > 0) { location = lines[i - 1]; break; }
          }
        }
      }

      return {
        url: window.location.href,
        raw_text: main.innerText,
        sections: sections,
        location: location
      };
    });

    logger.debug({ event: 'profile.extracted' }, 'profile data extracted');

    // Small delay before closing
    await randomDelay(500, 1500);

    await browser.close();
    return profileData;

  } catch (error) {
    await browser.close();
    throw error;
  }
}

export async function searchLinkedIn(query, type = 'people', options = {}) {
  logger.info({ event: 'search.start', query, type }, 'starting LinkedIn search');

  // Validate session before making request
  const { validateSession, relogin } = await import('./session.js');
  const isValid = await validateSession();

  if (!isValid) {
    if (options.autoRelogin) {
      logger.info({ event: 'session.invalid' }, 'session invalid — attempting auto-relogin');
      const loginSuccess = await relogin();
      if (!loginSuccess) {
        throw new Error('Auto-relogin failed. Please run: node src/index.js login');
      }
    } else {
      throw new Error('LinkedIn session expired. Please run: node src/index.js login');
    }
  }

  // Check and enforce rate limiting
  logger.debug('checking rate limit');
  await checkRateLimit();

  logger.debug('launching browser');
  const browser = await getBrowser({ headless: options.headless });

  const page = await getLinkedInPage(browser);

  try {
    // Human-like delay before search
    await randomDelay(1500, 3000);

    const searchUrl = `https://www.linkedin.com/search/results/${type}/?keywords=${encodeURIComponent(query)}`;
    logger.debug({ event: 'search.navigate', searchUrl }, 'navigating to search URL');

    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      logger.debug('navigation complete');
    } catch (navError) {
      const currentUrl = page.url();
      // Take screenshot for debugging
      await page.screenshot({ path: '/tmp/linkedin-error.png' }).catch(() => {});
      logger.error(
        { event: 'search.nav_failed', err: navError.message, currentUrl, screenshot: '/tmp/linkedin-error.png' },
        'navigation failed'
      );
      throw navError;
    }

    // Check what page we're actually on
    const pageTitle = await page.title();
    const currentUrl = page.url();
    logger.debug({ event: 'search.landed', pageTitle, currentUrl }, 'arrived at page');

    // Check if we're being asked to log in or verify
    // Be more specific - check for actual login form, not just "Sign in" text in nav
    const isLoginPage = await page.evaluate(() => {
      const hasLoginForm = document.querySelector('input[name="session_key"]') !== null;
      const hasPasswordInput = document.querySelector('input[type="password"][name="session_password"]') !== null;
      const isAuthChallenge = window.location.href.includes('/authwall') ||
                              window.location.href.includes('/checkpoint');

      return hasLoginForm || hasPasswordInput || isAuthChallenge;
    });

    if (isLoginPage) {
      await page.screenshot({ path: '/tmp/linkedin-login-wall.png' }).catch(() => {});
      logger.error(
        { event: 'search.login_wall', screenshot: '/tmp/linkedin-login-wall.png' },
        'detected login/verification page — cookies may have expired'
      );
      throw new Error('LinkedIn requires login. Cookies may have expired. Please run: node src/index.js login');
    }

    // Wait for search results
    await page.waitForSelector('.search-results-container', { timeout: 10000 }).catch(() => {
      logger.warn({ event: 'search.results_container_missing' }, 'search results container not found, continuing anyway');
    });

    // Human-like delay after page load
    await humanLikeDelay(page);

    logger.debug('extracting page content for LLM parsing');

    // Instead of fragile selectors, just grab all the text content from the main area
    // Let the LLM parse it - it's way better at this than CSS selectors
    const pageContent = await page.evaluate(() => {
      // Get the main search results area
      const main = document.querySelector('main');
      if (!main) return { raw_text: document.body.innerText, profile_links: [] };

      // Extract ALL links that look like profile URLs
      const allLinks = Array.from(main.querySelectorAll('a'));
      const profileLinks = allLinks
        .map(a => a.href)
        .filter(href => href && href.includes('/in/') && !href.includes('/search/'))
        .filter((href, index, self) => self.indexOf(href) === index); // unique only

      console.log(`Found ${profileLinks.length} profile links`);

      // Get all list items that might be results (use loose selector)
      const listItems = main.querySelectorAll('li');
      const results = [];

      listItems.forEach((li, index) => {
        const text = li.innerText?.trim();
        const links = Array.from(li.querySelectorAll('a')).map(a => ({
          text: a.innerText?.trim(),
          href: a.href
        })).filter(l => l.href && l.href.includes('linkedin.com'));

        if (text && text.length > 10) {
          results.push({
            index,
            text,
            links,
            html: li.outerHTML.substring(0, 500) // First 500 chars for context
          });
        }
      });

      return {
        raw_text: main.innerText,
        structured_items: results,
        profile_links: profileLinks,
        url: window.location.href
      };
    });

    logger.debug(
      { event: 'search.extracted', itemCount: pageContent.structured_items?.length || 0 },
      'extracted potential result items'
    );

    // Return the raw content for LLM to parse
    const result = {
      query,
      type,
      url: currentUrl,
      pageContent: pageContent,
      timestamp: new Date().toISOString()
    };

    // Small delay before closing
    await randomDelay(500, 1500);
    await browser.close();

    return result;

  } catch (error) {
    await browser.close();
    throw error;
  }
}
