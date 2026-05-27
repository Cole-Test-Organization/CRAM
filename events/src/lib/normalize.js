// Normalize the messy free-text fields that come off scraped event cards
// into the structured shape our `events` table expects.
//
// Locations on PAN cards are usually "City, Region, Country" (sometimes with
// the country duplicated, sometimes just "City, Country"). Dates are short
// "Mon D HH:MM AM TZ" strings without an explicit year. We do best-effort
// parsing and stash the original verbatim string in `location_raw` for cases
// the heuristic gets wrong.

const MONTHS = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

const COUNTRY_ALIASES = {
  'usa': 'USA',
  'us': 'USA',
  'united states': 'USA',
  'united states of america': 'USA',
  'uk': 'United Kingdom',
  'united kingdom': 'United Kingdom',
  'türkiye': 'Türkiye',
  'turkiye': 'Türkiye',
  'turkey': 'Türkiye',
};

function canonicalCountry(raw) {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  return COUNTRY_ALIASES[key] || raw.trim();
}

// "Antalya, Türkiye, Türkiye" → { city: "Antalya", state: "Türkiye", country: "Türkiye" }
// "San Francisco, CA, USA"   → { city: "San Francisco", state: "CA", country: "USA" }
// "London, United Kingdom"   → { city: "London", state: null, country: "United Kingdom" }
// "Tokyo"                    → { city: "Tokyo", state: null, country: null }
// null / "" / "Online"       → { city: null, state: null, country: null }
export function parseLocation(raw) {
  if (!raw) return { city: null, state: null, country: null };
  const cleaned = raw.trim();
  if (!cleaned) return { city: null, state: null, country: null };

  // Virtual / non-physical strings that sometimes leak into the location slot.
  if (/^(online|virtual|on[- ]?demand|zoom|webinar|webcast|tbd)/i.test(cleaned)) {
    return { city: null, state: null, country: null };
  }

  const parts = cleaned.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 1) {
    return { city: parts[0], state: null, country: null };
  }
  if (parts.length === 2) {
    return { city: parts[0], state: null, country: canonicalCountry(parts[1]) };
  }
  // 3+ parts: city, state/region, country. Drop trailing dupes
  // (PAN sometimes emits "City, Country, Country").
  const last = parts[parts.length - 1];
  const secondLast = parts[parts.length - 2];
  if (last.toLowerCase() === secondLast.toLowerCase()) {
    return {
      city: parts.slice(0, -2).join(', '),
      state: null,
      country: canonicalCountry(last),
    };
  }
  return {
    city: parts.slice(0, -2).join(', '),
    state: secondLast,
    country: canonicalCountry(last),
  };
}

// "In-Person", "Online", "Zoom Webinar", "On-Demand" → mode enum
// Falls back to null when the label doesn't fit any bucket — caller should
// surface the original label in `location_raw` so it isn't lost.
export function parseMode(eventType, location) {
  const t = (eventType || '').toLowerCase();
  if (/in[- ]?person/.test(t)) return 'in_person';
  if (/on[- ]?demand/.test(t)) return 'on_demand';
  if (/hybrid/.test(t)) return 'hybrid';
  if (/online|virtual|webinar|webcast|zoom|test drive|workshop/.test(t)) return 'virtual';
  // Fallback: location string smells physical → in_person
  if (location && /,/.test(location)) return 'in_person';
  return null;
}

// "May 7 09:00 AM TRT" → { start_date: "2026-05-07", end_date: null }
// "May 7-9 09:00 AM TRT" / "May 7-9, 2026" → start + end on same/adjacent days
// "May 7-Jun 2 09:00 AM TRT" → cross-month range
// Year is inferred when missing: if the parsed month is more than 6 months
// in the past, bump to next year; otherwise keep the current year.
export function parseDateRange(raw, now = new Date()) {
  if (!raw) return { start_date: null, end_date: null };
  const text = raw.trim();
  if (!text) return { start_date: null, end_date: null };

  // Try "Mon D - Mon D[, YYYY]" (cross-month)
  const cross = text.match(/([A-Za-z]+)\s+(\d{1,2})\s*[-–]\s*([A-Za-z]+)\s+(\d{1,2})(?:,?\s*(\d{4}))?/);
  if (cross) {
    const [, m1, d1, m2, d2, y] = cross;
    const year = y ? Number(y) : inferYear(MONTHS[m1.toLowerCase()], now);
    const start = isoDate(year, MONTHS[m1.toLowerCase()], Number(d1));
    let endYear = year;
    if (MONTHS[m2.toLowerCase()] < MONTHS[m1.toLowerCase()]) endYear = year + 1;
    const end = isoDate(endYear, MONTHS[m2.toLowerCase()], Number(d2));
    return { start_date: start, end_date: end };
  }

  // Try "Mon D-D[, YYYY]" (same month range)
  const sameMonth = text.match(/([A-Za-z]+)\s+(\d{1,2})\s*[-–]\s*(\d{1,2})(?:,?\s*(\d{4}))?/);
  if (sameMonth) {
    const [, m, d1, d2, y] = sameMonth;
    const month = MONTHS[m.toLowerCase()];
    if (month !== undefined) {
      const year = y ? Number(y) : inferYear(month, now);
      return {
        start_date: isoDate(year, month, Number(d1)),
        end_date: isoDate(year, month, Number(d2)),
      };
    }
  }

  // Try "Mon D[, YYYY]" (single day)
  const single = text.match(/([A-Za-z]+)\s+(\d{1,2})(?:,?\s*(\d{4}))?/);
  if (single) {
    const [, m, d, y] = single;
    const month = MONTHS[m.toLowerCase()];
    if (month !== undefined) {
      const year = y ? Number(y) : inferYear(month, now);
      return { start_date: isoDate(year, month, Number(d)), end_date: null };
    }
  }

  return { start_date: null, end_date: null };
}

function inferYear(month, now) {
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  // Six-month lookback: anything more than half a year in the past must be
  // about next year. Past few months we keep this year (the event already
  // happened — that's fine, the upsert is idempotent).
  if (month < currentMonth - 6) return currentYear + 1;
  return currentYear;
}

function isoDate(year, month, day) {
  const m = String(month + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

// Stable identifier across re-scrapes when the source doesn't expose one.
// We hash (registration URL || title + start_date) so re-running upserts
// the same row instead of duplicating it.
export function buildSourceId({ url, title, start_date }) {
  if (url) return url;
  return `${slugify(title)}__${start_date || 'undated'}`;
}

function slugify(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
}
