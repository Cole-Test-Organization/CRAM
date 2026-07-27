// URL-safe slug derivation, shared by every place the GUI auto-fills a slug
// from a typed name (account / vendor / vendor-product creation, theme naming).
// Mirrors the server's api/src/services/_shared/_slug.ts so a slug the GUI
// previews matches the one the API stores.

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Same shape, but guaranteed non-empty and length-capped — for slugs that name
// a file or a stored record, where an empty string isn't a usable identifier.
export function slugifyWithFallback(value: string, fallback: string): string {
  return slugify(value).slice(0, 60) || fallback;
}
