#!/usr/bin/env node
// CLI entry point for the events scraper. Currently ships one source
// (paloaltonetworks) as an example; the architecture is set up to add more by
// dropping new files into src/scrapers/ and wiring them into the SCRAPERS map.
//
// Usage:
//   node events/src/index.js scrape --source paloaltonetworks
//   node events/src/index.js scrape --no-write   # dry run, prints JSON only
//   node events/src/index.js scrape --api-url http://localhost:3200

import { runCli } from '../../tools/argv.js';
import { scrape as scrapePalo } from './scrapers/paloaltonetworks.js';
import { logger } from './logger.js';

const SCRAPERS = {
  paloaltonetworks: scrapePalo,
};

await runCli({
  name: 'events',
  description: 'Scrape external event calendars and upsert into the CRM API',
  commands: {
    scrape: {
      description: 'Run a scraper and POST results to /api/events',
      usage: 'scrape [options]',
      options: {
        source:       { type: 'string',  short: 's', default: 'paloaltonetworks', description: 'Scraper source' },
        'api-url':    { type: 'string',  default: process.env.CRM_API_URL || 'http://localhost:3200', description: 'CRM API base URL' },
        write:        { type: 'boolean', default: true, description: 'Upsert events to the API (use --no-write for dry run)' },
        headless:     { type: 'boolean', default: true, description: 'Run the scraper headless (use --no-headless for debugging)' },
        'max-clicks': { type: 'string',  default: '50', coerce: (v) => parseInt(v, 10), description: 'Cap on See More clicks' },
      },
      async run({ options }) {
        const scrapeFn = SCRAPERS[options.source];
        if (!scrapeFn) {
          logger.error(
            { event: 'scrape.unknown_source', source: options.source, known: Object.keys(SCRAPERS) },
            'unknown scraper source'
          );
          process.exit(2);
        }
        logger.info({ event: 'scrape.start', source: options.source }, 'scraping');
        const events = await scrapeFn({
          headless: options.headless,
          maxClicks: options['max-clicks'],
          onProgress: (e) => logger.debug({ event: 'scrape.progress', ...e }, 'scrape progress'),
        });
        logger.info({ event: 'scrape.done', source: options.source, count: events.length }, 'scraped events');

        if (!options.write) {
          process.stdout.write(JSON.stringify(events, null, 2) + '\n');
          return;
        }

        let ok = 0;
        let failed = 0;
        for (const event of events) {
          // Drop nulls — the DB columns are nullable, but the Fastify route schema
          // uses enums that reject `null`. Omitted fields stay at their column
          // default (NULL) which is what we want.
          const payload = Object.fromEntries(
            Object.entries(event).filter(([, v]) => v != null)
          );
          try {
            const res = await fetch(`${options['api-url'].replace(/\/$/, '')}/api/events`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            if (!res.ok) {
              const body = await res.text();
              throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
            }
            ok++;
          } catch (err) {
            failed++;
            logger.warn(
              { event: 'upsert.failed', title: event.title, err: err.message },
              'event upsert failed'
            );
          }
        }
        logger.info(
          { event: 'upsert.summary', ok, failed, total: events.length },
          'upsert summary'
        );
        if (failed > 0) process.exitCode = 1;
      },
    },
  },
});
