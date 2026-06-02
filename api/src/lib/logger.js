// Shared Pino logger for Node processes in this repo.
//
// Output flows to the process's stdout, which Docker captures into the
// container's log buffer. Each line is JSON in production (one structured
// event per line, easy to parse or ship to a log aggregator); pretty-printed
// in dev for terminal readability.
//
// `logger` is the default API instance (service=api). Other entry points that
// run as their own process inside the same container (e.g. the MCP server)
// should call `createLogger({ service: 'foo' })` so log lines can
// be filtered by service.
//
// Inside Fastify route handlers, prefer `req.log` over importing this directly
// — Fastify creates a child logger per request with a `reqId` field, which
// lets you reconstruct a full request flow by filtering on that field.
//
// Conventions:
//   - First arg is an object of structured fields: { event, component, ... }
//   - Second arg is a human-readable message
//   - High-cardinality values (userId, accountId) go in the JSON body.

import pino from 'pino';

const isProd = process.env.NODE_ENV === 'production';

export function createLogger(bindings = {}) {
  return pino({
    level: process.env.LOG_LEVEL || 'info',
    base: bindings,
    ...(isProd
      ? {}
      : {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss.l',
              ignore: 'pid,hostname',
            },
          },
        }),
  });
}

export const logger = createLogger({ service: 'api' });
