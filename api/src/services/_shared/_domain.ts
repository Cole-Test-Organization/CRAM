// Domain-string helpers shared across the import + account-resolution services.
// Kept dependency-free so any service can pull just the piece it needs.

// Normalize a single domain: lowercase, strip protocol / leading "www." / any
// path. Returns null for anything that isn't a usable domain string (null,
// non-string, or empty after cleaning).
export function normalizeDomain(d: unknown): string | null {
  if (!d || typeof d !== 'string') return null;
  return d.trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '') || null;
}

// Split a comma-separated domain string into a deduped, normalized list
// (drops blanks/garbage). The building block for the env-var readers below.
export function parseDomainList(str: unknown): string[] {
  const seen = new Set<string>();
  for (const part of String(str || '').split(',')) {
    const d = normalizeDomain(part);
    if (d) seen.add(d);
  }
  return [...seen];
}

// Read one comma-separated env var (e.g. CALENDAR_PARTNER_DOMAINS) into a Set
// of normalized domains. Empty/unset → empty Set.
export function envDomainSet(varName: string): Set<string> {
  return new Set(parseDomainList(process.env[varName] || ''));
}

// "acme-corp.com" → "Acme Corp" — a best-effort display name for an
// auto-created customer account.
export function suggestAccountName(domain: string | null | undefined): string {
  if (!domain) return '';
  const base = domain.split('.').slice(0, -1).join('.') || domain;
  return base
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
