// Scraper for https://www.paloaltonetworks.com/resources/event-calendar.
//
// The page is a Coveo-backed SPA — the public token endpoint exists but the
// returned JWT's permission identity is gated to a different index, so direct
// API access returns zero results. We render the page in headless Chromium
// instead and read the same DOM a user would see. The "See More" pagination
// button at the bottom of the events list keeps revealing more cards until
// it disappears (or stops adding new ones).
//
// Selectors confirmed live (May 2026):
//   .tab-card-wrapper                — one per event card
//   .tab-card-wrapper .event-type    — "In-Person" / "Online" / "Zoom Webinar" / etc.
//   .tab-card-wrapper .card-heading  — event title
//   .tab-card-wrapper .location      — "City, State, Country" (in-person only)
//   .tab-card-wrapper .date          — "Mon D HH:MM AM TZ"
//   .tab-card-wrapper .description   — summary
//   .tab-card-wrapper .event-info .status — LIVE / FEATURED / ON-DEMAND / etc.
//   .btn-see-more                    — load-more button at bottom of events list

import puppeteer from 'puppeteer';
import { parseLocation, parseMode, parseDateRange, buildSourceId } from '../lib/normalize.js';

const SOURCE = 'paloaltonetworks';
const URL = 'https://www.paloaltonetworks.com/resources/event-calendar';
const SEE_MORE_SELECTOR = '.btn-see-more';
const CARD_SELECTOR = '.tab-card-wrapper';
const MAX_PAGE_CLICKS = 50; // safety net — the calendar typically has under ~200 events

export async function scrape({ headless = true, maxClicks = MAX_PAGE_CLICKS, onProgress } = {}) {
  const browser = await puppeteer.launch({
    headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1440, height: 1200 });

    onProgress?.({ stage: 'navigating', url: URL });
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });

    onProgress?.({ stage: 'waiting_for_cards' });
    await page.waitForSelector(CARD_SELECTOR, { timeout: 30000 });
    // Coveo finishes rendering a beat after networkidle.
    await sleep(4000);

    let lastCount = 0;
    for (let click = 0; click < maxClicks; click++) {
      const count = await page.$$eval(CARD_SELECTOR, (els) => els.length);
      onProgress?.({ stage: 'paginating', click, cards: count });
      if (count === lastCount && click > 0) break;
      lastCount = count;

      // Find the See More button. It's hidden when no more results to load.
      const clicked = await page.evaluate((sel) => {
        const btn = document.querySelector(sel);
        if (!btn || btn.offsetParent === null) return false;
        btn.scrollIntoView({ block: 'center' });
        btn.click();
        return true;
      }, SEE_MORE_SELECTOR);

      if (!clicked) break;
      // Wait for new cards to render. Coveo updates the DOM after a fetch.
      await sleep(2500);
    }

    onProgress?.({ stage: 'extracting' });
    const raw = await page.$$eval(CARD_SELECTOR, (cards) => cards.map((card) => {
      const text = (sel) => card.querySelector(sel)?.innerText?.trim() || null;
      // Prefer an <a> with a real http(s) href inside the card. Fall back to
      // an ancestor anchor in case the card itself is wrapped in a link.
      // Cards in "Event in progress" / "Registration full" states have no
      // anchor at all — we leave url=null here and let the caller decide on
      // a fallback so source_id stays unique per event.
      const inside = Array.from(card.querySelectorAll('a'))
        .map((a) => a.href)
        .filter((href) => href && /^https?:/i.test(href));
      let url = inside[0] || null;
      if (!url) {
        const ancestor = card.closest('a');
        if (ancestor && /^https?:/i.test(ancestor.href || '')) url = ancestor.href;
      }
      return {
        title: text('.card-heading'),
        eventType: text('.event-type'),
        location: text('.location'),
        date: text('.date'),
        description: text('.description'),
        status: text('.event-info .status'),
        url,
      };
    }));

    onProgress?.({ stage: 'normalizing', total: raw.length });

    const seen = new Set();
    const events = [];
    for (const r of raw) {
      if (!r.title) continue;
      const { city, state, country } = parseLocation(r.location);
      const mode = parseMode(r.eventType, r.location);
      const { start_date, end_date } = parseDateRange(r.date);
      const source_id = buildSourceId({ url: r.url, title: r.title, start_date });

      // De-dupe within a single scrape run; the DB upsert handles cross-run dedupe.
      if (seen.has(source_id)) continue;
      seen.add(source_id);

      const tags = [];
      if (r.status) tags.push(r.status.toLowerCase());
      if (r.eventType) tags.push(r.eventType.toLowerCase());

      events.push({
        source: SOURCE,
        source_id,
        title: r.title,
        summary: r.description || null,
        start_date,
        end_date,
        mode,
        location_raw: r.location || r.eventType || null,
        city,
        state,
        country,
        venue: null, // PAN cards don't break out venue separately
        // Prefer the per-event registration URL; otherwise fall back to the
        // calendar listing so the UI always has somewhere to send the user.
        url: r.url || URL,
        tags,
      });
    }

    onProgress?.({ stage: 'done', total: events.length });
    return events;
  } finally {
    await browser.close();
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
