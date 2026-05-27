import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger as rootLogger } from '../logger.js';

const logger = rootLogger.child({ component: 'ratelimit' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RATE_LIMIT_FILE = path.join(__dirname, '../../.ratelimit.json');

// Minimum delay between LinkedIn requests (in milliseconds)
const MIN_DELAY = 10000; // 10 seconds
const RECOMMENDED_DELAY = 30000; // 30 seconds

async function loadRateLimitData() {
  try {
    const data = await fs.readFile(RATE_LIMIT_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { lastRequest: 0, requestCount: 0, dailyCount: 0, lastResetDate: new Date().toDateString() };
  }
}

async function saveRateLimitData(data) {
  await fs.writeFile(RATE_LIMIT_FILE, JSON.stringify(data, null, 2));
}

export async function checkRateLimit() {
  const data = await loadRateLimitData();
  const now = Date.now();
  const today = new Date().toDateString();

  // Reset daily counter if it's a new day
  if (data.lastResetDate !== today) {
    data.dailyCount = 0;
    data.lastResetDate = today;
  }

  // Check daily limit (conservative: 50 requests per day)
  if (data.dailyCount >= 50) {
    throw new Error('Daily LinkedIn request limit reached (50). Please try again tomorrow.');
  }

  // Check time since last request
  const timeSinceLastRequest = now - data.lastRequest;

  if (timeSinceLastRequest < MIN_DELAY) {
    const waitMs = MIN_DELAY - timeSinceLastRequest;
    logger.warn(
      { event: 'ratelimit.throttle', waitMs, waitSeconds: Math.ceil(waitMs / 1000) },
      'rate limit — waiting before next request'
    );
    await new Promise(resolve => setTimeout(resolve, waitMs));
  } else if (timeSinceLastRequest < RECOMMENDED_DELAY) {
    const waitMs = RECOMMENDED_DELAY - timeSinceLastRequest;
    logger.info(
      { event: 'ratelimit.below_recommended', waitMs, waitSeconds: Math.ceil(waitMs / 1000) },
      'below recommended delay — continuing anyway'
    );
  }

  // Update rate limit data
  data.lastRequest = Date.now();
  data.requestCount++;
  data.dailyCount++;

  await saveRateLimitData(data);

  return data;
}

export async function getRateLimitStats() {
  const data = await loadRateLimitData();
  const today = new Date().toDateString();

  if (data.lastResetDate !== today) {
    return {
      dailyCount: 0,
      totalCount: data.requestCount,
      lastRequest: data.lastRequest ? new Date(data.lastRequest).toLocaleString() : 'Never'
    };
  }

  return {
    dailyCount: data.dailyCount,
    dailyLimit: 50,
    totalCount: data.requestCount,
    lastRequest: data.lastRequest ? new Date(data.lastRequest).toLocaleString() : 'Never'
  };
}
