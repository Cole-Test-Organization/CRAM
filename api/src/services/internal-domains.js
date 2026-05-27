// Per-user "internal domains" list — the email domains the user's own company
// owns. Reads from the user_internal_domains table under RLS. The from-emails
// meeting flow consults this to decide whether an attendee should be flagged
// kind=internal (skip account creation, skip research).
//
// Env-var fallback: if a user has no rows yet, we fall back to SELF_DOMAINS
// / INTERNAL_DOMAINS so a fresh install with the env var configured behaves
// the same way it did before the per-user store existed. Once the user adds
// even one row, the env var is ignored (the user's curated list wins).

import { withUser } from '../db/connection.js';

function normalizeDomain(d) {
  if (!d || typeof d !== 'string') return null;
  const cleaned = d.trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
  return cleaned || null;
}

function envFallback() {
  const raw = process.env.SELF_DOMAINS || process.env.INTERNAL_DOMAINS || '';
  return raw.split(',').map(normalizeDomain).filter(Boolean);
}

export class InternalDomainsService {
  async list(userId) {
    return withUser(userId, async (client) => {
      const rows = (await client.query(
        `SELECT domain, created_at
         FROM user_internal_domains
         ORDER BY domain`
      )).rows;
      return rows.map((r) => ({ domain: r.domain, created_at: r.created_at }));
    });
  }

  // Returns the set of domain strings to treat as internal for this user.
  // Used by services that just need fast "is this internal?" checks (e.g.
  // resolveEmails). Falls back to env vars when the user has no rows yet.
  async getDomainSet(userId) {
    const rows = await this.list(userId);
    if (rows.length === 0) return new Set(envFallback());
    return new Set(rows.map((r) => r.domain));
  }

  async add(userId, domain) {
    const normalized = normalizeDomain(domain);
    if (!normalized) {
      throw Object.assign(new Error('domain is required — a bare domain like "paloaltonetworks.com". URLs and www. prefixes are normalized; must contain at least one "." after normalization.'), { statusCode: 400 });
    }
    if (!normalized.includes('.')) {
      throw Object.assign(new Error(`Domain "${normalized}" does not contain a "." after normalization. Pass a real domain (e.g. "paloaltonetworks.com"), not a bare word.`), { statusCode: 400 });
    }
    return withUser(userId, async (client) => {
      // ON CONFLICT keeps add() idempotent — repeated calls return the
      // existing row without erroring out.
      const row = (await client.query(
        `INSERT INTO user_internal_domains (user_id, domain)
         VALUES (current_setting('app.current_user_id')::bigint, $1)
         ON CONFLICT (user_id, domain) DO UPDATE SET domain = EXCLUDED.domain
         RETURNING domain, created_at`,
        [normalized]
      )).rows[0];
      return { domain: row.domain, created_at: row.created_at };
    });
  }

  async remove(userId, domain) {
    const normalized = normalizeDomain(domain);
    if (!normalized) {
      throw Object.assign(new Error('domain is required (the bare domain to drop from the internal list). Use action="list" to see currently flagged domains.'), { statusCode: 400 });
    }
    return withUser(userId, async (client) => {
      const result = await client.query(
        `DELETE FROM user_internal_domains WHERE domain = $1`,
        [normalized]
      );
      return { domain: normalized, deleted: result.rowCount > 0 };
    });
  }
}
