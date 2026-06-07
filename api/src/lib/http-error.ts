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
