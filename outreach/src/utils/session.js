import { getBrowser, loadCookies, saveCookies } from './browser.js';
import { logger as rootLogger } from '../logger.js';

const logger = rootLogger.child({ component: 'session' });

/**
 * Validates if the current cookies are still valid by checking LinkedIn
 * @returns {Promise<boolean>} true if session is valid, false otherwise
 */
export async function validateSession() {
  logger.debug('validating LinkedIn session');

  try {
    const browser = await getBrowser();
    const page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const cookiesLoaded = await loadCookies(page);

    if (!cookiesLoaded) {
      logger.debug({ event: 'session.no_cookies' }, 'no cookies found');
      await browser.close();
      return false;
    }

    // Navigate to LinkedIn feed to check if we're logged in
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 15000 });

    // Check if we're on the feed page (logged in) or login page (not logged in)
    const isLoggedIn = await page.evaluate(() => {
      const url = window.location.href;
      const hasLoginForm = document.querySelector('input[name="session_key"]') !== null;
      const hasSignIn = document.body.innerHTML.includes('Sign in to stay updated');

      // If we're on feed and no login form, we're good
      return (url.includes('/feed') || url.includes('/in/')) && !hasLoginForm && !hasSignIn;
    });

    await browser.close();

    logger.info(
      { event: 'session.validated', valid: isLoggedIn },
      isLoggedIn ? 'session is valid' : 'session is invalid (cookies expired)'
    );

    return isLoggedIn;

  } catch (error) {
    logger.error({ event: 'session.validate_error', err: error.message }, 'session validation error');
    return false;
  }
}

/**
 * Interactive re-login flow
 * @returns {Promise<boolean>} true if login successful
 */
export async function relogin() {
  logger.info({ event: 'session.relogin' }, 'session expired — starting re-login process');

  const { loginToLinkedIn } = await import('./browser.js');
  await loginToLinkedIn();

  // Validate the new session
  return await validateSession();
}
