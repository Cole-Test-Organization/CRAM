// Shared HTTP-shaped errors. The `statusCode` property is read by the Fastify
// error handler (and the MCP layer) to set the response status; an Error
// without one is treated as a 500. Throw these instead of hand-rolling
// `Object.assign(new Error(msg), { statusCode })` at every call site.

export interface HttpError extends Error {
  statusCode: number;
}

export function httpError(statusCode: number, message: string): HttpError {
  return Object.assign(new Error(message), { statusCode });
}

export const badRequest = (message: string): HttpError => httpError(400, message);
export const notFound = (message: string): HttpError => httpError(404, message);
export const conflict = (message: string): HttpError => httpError(409, message);
export const forbidden = (message: string): HttpError => httpError(403, message);

// Postgres unique-violation.
export const isUniqueViolation = (err: unknown): boolean =>
  (err as { code?: string } | null)?.code === '23505';

// `.catch(rethrowUniqueViolation('…'))` on a write that can collide. Turns the
// raw pg error into a 409 whose message names the row, so the HTTP route and the
// MCP tool report the same specific text instead of MCP's generic "already
// exists" — and routes don't each hand-roll the translation.
//
// The original `code` is deliberately carried over: in-process callers
// (calendar-import, notes-import, the meetings merge handler) branch on
// `code === '23505'` to mean "already there, skip". Dropping it would turn an
// idempotent re-import into a hard error.
export function rethrowUniqueViolation(message: string) {
  return (err: unknown): never => {
    if (isUniqueViolation(err)) {
      throw Object.assign(conflict(message), { code: '23505', cause: err });
    }
    throw err;
  };
}
