import { getBrowser, loadCookies, readCookiesRaw } from './browser.js';
import { logger as rootLogger } from '../logger.js';

const logger = rootLogger.child({ component: 'session' });

/**
 * Cheap, local-only session check — no browser, no network.
 *
 * Confirms the saved cookie jar exists, parses, carries the li_at auth cookie,
 * and that li_at isn't already past its stored expiry. This is the default
 * pre-flight gate for scrape/search so we don't fire an uncounted, un-throttled
 * LinkedIn request before every operation. A session that is locally valid but
 * actually stale server-side is caught by the in-flight auth-wall detection in
 * the scrape/search navigation itself.
 *
 * @returns {Promise<boolean>} true if the cookie jar looks usable locally
 */
export async function validateSessionLocal() {
  const cookies = await readCookiesRaw();

  if (!cookies || !Array.isArray(cookies) || cookies.length === 0) {
    logger.debug({ event: 'session.no_cookies' }, 'no cookies found');
    return false;
  }

  const liAt = cookies.find((c) => c.name === 'li_at');

  if (!liAt || !liAt.value) {
    logger.debug({ event: 'session.no_li_at' }, 'li_at auth cookie missing');
    return false;
  }

  // Puppeteer stores `expires` as a Unix timestamp in seconds; -1 means a
  // session cookie with no expiry. Only treat a real, past expiry as stale.
  if (typeof liAt.expires === 'number' && liAt.expires > 0 && liAt.expires * 1000 < Date.now()) {
    logger.info({ event: 'session.li_at_expired' }, 'li_at auth cookie has expired');
    return false;
  }

  logger.debug({ event: 'session.local_ok' }, 'cookie jar looks valid (local check)');
  return true;
}

/**
 * Validates the current LinkedIn session.
 *
 * By default (`probe = false`) this is a cheap, local-only check (see
 * {@link validateSessionLocal}) — no browser launch, no LinkedIn request — so
 * scrape/search don't double LinkedIn traffic with an uncounted /feed load.
 *
 * Pass `probe = true` to additionally launch a browser and load the LinkedIn
 * feed to confirm the session is live server-side. This issues a real (still
 * uncounted) LinkedIn request and is reserved for places a human explicitly
 * asks for it — the CLI `status` command and the post-login re-validation.
 *
 * @param {boolean} [probe=false] when true, also hit LinkedIn to confirm the session is live
 * @returns {Promise<boolean>} true if session is valid
 */
export async function validateSession(probe = false) {
  logger.debug({ event: 'session.validate', probe }, 'validating LinkedIn session');

  if (!probe) {
    return validateSessionLocal();
  }

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

  // Validate the new session with a real probe — a human just logged in and we
  // want to confirm the cookies actually work server-side, not just locally.
  return await validateSession(true);
}
