// In-process cron scheduler. Long-running jobs (scrapes, etc.) run as
// subprocesses so a crash or memory leak in Puppeteer can't take down the API.
//
// Set DISABLE_SCHEDULER=1 to skip registration (useful for tests / local dev).
// Override the events scrape cadence with EVENTS_SCRAPE_CRON.

import * as cron from './lib/cron.js';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { logger as rootLogger } from './lib/logger.js';

const logger = rootLogger.child({ component: 'scheduler' });

const EVENTS_SCRAPER_ENTRY = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  'events',
  'src',
  'index.js'
);

const EVENTS_SCRAPE_CRON = process.env.EVENTS_SCRAPE_CRON || '0 6 * * *';

function runEventsScrape() {
  const apiUrl = `http://localhost:${process.env.PORT || 3200}`;
  logger.info({ event: 'events_scrape.start', apiUrl }, 'starting events scrape');

  const child = spawn(
    'node',
    [EVENTS_SCRAPER_ENTRY, 'scrape', '--api-url', apiUrl],
    { stdio: ['ignore', 'inherit', 'inherit'] }
  );

  child.on('exit', (code) => {
    if (code === 0) {
      logger.info({ event: 'events_scrape.completed', exitCode: code }, 'events scrape completed');
    } else {
      logger.error({ event: 'events_scrape.failed', exitCode: code }, 'events scrape exited non-zero');
    }
  });
  child.on('error', (err) => {
    logger.error({ event: 'events_scrape.spawn_failed', err: err.message }, 'failed to spawn scraper');
  });
}

// Backup scheduling lives in a closure so updateSettings can call reschedule()
// without a process restart. The handle is null when backups are disabled OR
// when the configured cron is invalid (latter is logged once at parse time).
function makeBackupScheduler(backupService) {
  let handle = null;
  let currentCron = null;

  async function reschedule(settings) {
    const next = settings || await backupService.getSettings();
    const wantsRun = next.enabled && cron.validate(next.cron);

    if (!wantsRun) {
      if (handle) {
        handle.stop();
        handle = null;
        currentCron = null;
        logger.info({ event: 'backup.unscheduled' }, 'backup job stopped');
      }
      if (next.enabled && !cron.validate(next.cron)) {
        logger.error({ event: 'backup.invalid_cron', cron: next.cron }, 'invalid backup cron — job NOT scheduled');
      }
      return;
    }

    if (handle && currentCron === next.cron) return; // no-op when nothing changed

    if (handle) handle.stop();
    currentCron = next.cron;
    handle = cron.schedule(next.cron, () => {
      backupService.runBackup().catch((err) => {
        logger.error({ event: 'backup.cron_failed', err: err.message }, 'scheduled backup failed');
      });
    });
    logger.info({ event: 'backup.scheduled', cron: next.cron }, 'backup job scheduled');
  }

  return { reschedule };
}

export function startScheduler({ backupService } = {}) {
  if (process.env.DISABLE_SCHEDULER === '1') {
    logger.info({ event: 'scheduler.disabled' }, 'disabled via DISABLE_SCHEDULER=1');
    return;
  }

  if (!cron.validate(EVENTS_SCRAPE_CRON)) {
    logger.error(
      { event: 'scheduler.invalid_cron', cron: EVENTS_SCRAPE_CRON },
      'invalid EVENTS_SCRAPE_CRON expression — events scrape NOT scheduled'
    );
  } else {
    cron.schedule(EVENTS_SCRAPE_CRON, runEventsScrape);
    logger.info({ event: 'scheduler.scheduled', cron: EVENTS_SCRAPE_CRON }, 'events scrape scheduled');
  }

  if (backupService) {
    const { reschedule } = makeBackupScheduler(backupService);
    backupService.setOnSettingsChanged(reschedule);
    reschedule().catch((err) => {
      logger.error({ event: 'backup.initial_schedule_failed', err: err.message }, 'failed to load backup settings on startup');
    });
  }
}
