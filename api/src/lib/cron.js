// Minimal in-process cron scheduler — drop-in replacement for the small
// subset of node-cron we used (validate + schedule). Standard 5-field cron:
//
//   minute (0-59)  hour (0-23)  day-of-month (1-31)  month (1-12)  day-of-week (0-7, 0|7=Sun)
//
// Supported per-field syntax: literals, * wildcard, A,B,C lists, N-M ranges, */N steps.
// Day-of-month and day-of-week follow standard cron OR semantics: when both are
// restricted (neither is "*"), the job runs when EITHER matches.
//
// Not supported: named months/days (JAN, MON), @yearly/@daily shortcuts, seconds field.
// All times are evaluated in the process's local timezone (matches node-cron default).

import { logger as rootLogger } from './logger.js';

const logger = rootLogger.child({ component: 'cron' });

const FIELD_RANGES = [
  { name: 'minute',      min: 0, max: 59 },
  { name: 'hour',        min: 0, max: 23 },
  { name: 'dayOfMonth',  min: 1, max: 31 },
  { name: 'month',       min: 1, max: 12 },
  { name: 'dayOfWeek',   min: 0, max: 7  }, // 0 and 7 both mean Sunday
];

function parseField(raw, { min, max }) {
  // Returns a Set of numbers in [min, max] that match, or null if the field is
  // unconstrained ("*"). null is preserved (rather than expanded to a full set)
  // because cron's day-of-month / day-of-week OR semantics depend on knowing
  // whether each was restricted.
  if (raw === '*') return null;

  const out = new Set();
  for (const part of raw.split(',')) {
    const stepMatch = part.match(/^(.+?)\/(\d+)$/);
    let base = part;
    let step = 1;
    if (stepMatch) {
      base = stepMatch[1];
      step = parseInt(stepMatch[2], 10);
      if (!Number.isFinite(step) || step <= 0) throw new Error(`Invalid step "${part}"`);
    }

    let lo, hi;
    if (base === '*') {
      lo = min;
      hi = max;
    } else {
      const rangeMatch = base.match(/^(\d+)-(\d+)$/);
      if (rangeMatch) {
        lo = parseInt(rangeMatch[1], 10);
        hi = parseInt(rangeMatch[2], 10);
      } else {
        const n = parseInt(base, 10);
        if (!Number.isFinite(n)) throw new Error(`Invalid value "${part}"`);
        lo = hi = n;
      }
    }

    if (lo < min || hi > max || lo > hi) {
      throw new Error(`Value "${part}" out of range for field (allowed: ${min}-${max})`);
    }

    for (let n = lo; n <= hi; n += step) out.add(n);
  }
  return out;
}

function parseExpression(expr) {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Expected 5 fields, got ${fields.length}: "${expr}"`);
  }
  const parsed = {};
  fields.forEach((raw, i) => {
    parsed[FIELD_RANGES[i].name] = parseField(raw, FIELD_RANGES[i]);
  });
  // Normalize: Sunday is both 0 and 7
  if (parsed.dayOfWeek && parsed.dayOfWeek.has(7)) parsed.dayOfWeek.add(0);
  return parsed;
}

function matchesField(set, value) {
  return set === null || set.has(value);
}

function matches(spec, date) {
  const minute = date.getMinutes();
  const hour = date.getHours();
  const dayOfMonth = date.getDate();
  const month = date.getMonth() + 1;
  const dayOfWeek = date.getDay();

  if (!matchesField(spec.minute, minute)) return false;
  if (!matchesField(spec.hour, hour)) return false;
  if (!matchesField(spec.month, month)) return false;

  // Day-of-month / day-of-week OR semantics: if both are restricted, either matches.
  const domRestricted = spec.dayOfMonth !== null;
  const dowRestricted = spec.dayOfWeek !== null;
  if (domRestricted && dowRestricted) {
    return spec.dayOfMonth.has(dayOfMonth) || spec.dayOfWeek.has(dayOfWeek);
  }
  if (domRestricted) return spec.dayOfMonth.has(dayOfMonth);
  if (dowRestricted) return spec.dayOfWeek.has(dayOfWeek);
  return true;
}

export function validate(expr) {
  try {
    parseExpression(expr);
    return true;
  } catch {
    return false;
  }
}

export function schedule(expr, callback) {
  const spec = parseExpression(expr);
  let lastFiredMinute = null;

  function tick() {
    const now = new Date();
    // Truncate to minute precision so we don't fire twice if tick() is called
    // multiple times within the same minute (e.g. after the first aligned timeout).
    const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
    if (minuteKey === lastFiredMinute) return;
    if (matches(spec, now)) {
      lastFiredMinute = minuteKey;
      try {
        callback();
      } catch (err) {
        logger.error({ event: 'cron.callback_threw', expr, err: err.message }, 'cron callback threw');
      }
    }
  }

  // Align the first tick to the next minute boundary, then run on each minute.
  const now = new Date();
  const msToNextMinute = 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds());

  let interval;
  const timeout = setTimeout(() => {
    tick();
    interval = setInterval(tick, 60_000);
  }, msToNextMinute);

  return {
    stop() {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    },
  };
}
