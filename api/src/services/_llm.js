// Helpers for working with chatty local LLMs: a sleep for backoff/polling and a
// tolerant JSON extractor for small models that wrap their output in prose or
// code fences.

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Strip ```json fences / leading prose, then parse the first {...} block.
// Returns the parsed object, or null on any failure (never throws).
export function parseLooseJson(text) {
  if (typeof text !== 'string') return null;
  let t = text.trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) t = fence[1].trim();
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  try { return JSON.parse(t.slice(first, last + 1)); } catch { return null; }
}
