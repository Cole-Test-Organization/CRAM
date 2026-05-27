// Pino logger for the events scraper.
//
// Writes to stderr so stdout stays reserved for the CLI return value
// (`scrape --no-write` prints the scraped events as JSON on stdout). When the
// scraper is spawned from api/src/scheduler.js with `stdio: ['ignore',
// 'inherit', 'inherit']`, this stderr stream is inherited by the API
// container's stderr — Docker captures it into the container log buffer.
// Each line is JSON in production with `service=events`, so it's easy to
// filter when downstream consumers parse the stream.

import pino from 'pino';

const isProd = process.env.NODE_ENV === 'production';

const config = {
  level: process.env.LOG_LEVEL || 'info',
  base: { service: 'events' },
};

export const logger = isProd
  ? pino(config, pino.destination(2))
  : pino({
      ...config,
      transport: {
        target: 'pino-pretty',
        options: {
          destination: 2,
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      },
    });
