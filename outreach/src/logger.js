// Pino logger for the outreach service.
//
// Writes to stderr so stdout stays reserved for CLI return values
// (outreach/src/index.js prints JSON results via `console.log` on stdout — the
// scheduler and the in-process API caller depend on that contract).
//
// When outreach is invoked as a library (api/src/services/outreach.js imports
// researchPerson/researchCompany/researchIndustry directly), this logger
// writes to the API process's stderr — Docker captures it into the container
// log buffer. Each line is JSON in production with `service=outreach`, so
// it's easy to filter when downstream consumers parse the stream.

import pino from 'pino';

const isProd = process.env.NODE_ENV === 'production';

const config = {
  level: process.env.LOG_LEVEL || 'info',
  base: { service: 'outreach' },
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
