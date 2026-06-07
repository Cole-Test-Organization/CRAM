/**
 * MCP response formatting and error handling helpers.
 */

export function jsonResponse(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

export function textResponse(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

export function errorResponse(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

/**
 * Wraps a service call with standardized error handling.
 * Accepts a function that returns the result (sync or async).
 * Translates null-means-not-found, UNIQUE constraint, statusCode:400,
 * and generic errors into MCP-formatted responses.
 */
export async function callService(
  fn: () => unknown,
  { notFoundMsg = 'Not found' }: { notFoundMsg?: string } = {}
) {
  try {
    const result = await fn();
    if (result === null || result === undefined) {
      return errorResponse(notFoundMsg);
    }
    return jsonResponse(result);
  } catch (err) {
    const e = err as { code?: string; statusCode?: number; message?: string };
    if (e.code === '23505') {
      return errorResponse('Already exists: a record with that identifier already exists.');
    }
    if (e.statusCode === 400) {
      return errorResponse(`Validation error: ${e.message}`);
    }
    return errorResponse(`Error: ${e.message}`);
  }
}
