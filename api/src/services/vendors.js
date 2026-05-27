import { getPool } from '../db/connection.js';
import { slugify } from './_slug.js';
import { FUZZY_THRESHOLD, normalizeVendorName } from './_fuzzy-match.js';

const COLS = 'id, name, slug, website, notes, needs_review, deleted_at, created_at, updated_at';

// Global catalog — no RLS, no withUser wrapper. Vendors are shared across all
// users so analytics ("which of my accounts run Palo Alto?") work across the
// whole org.
export class VendorsService {
  async getAll({ search, include_deleted = false, needs_review, limit = 200, offset = 0 } = {}) {
    const client = await getPool().connect();
    try {
      const params = [];
      const conditions = [];
      if (!include_deleted) conditions.push('deleted_at IS NULL');
      if (needs_review === true || needs_review === false) {
        params.push(needs_review);
        conditions.push(`needs_review = $${params.length}`);
      }
      if (search) {
        params.push(`%${search}%`);
        conditions.push(`(name ILIKE $${params.length} OR slug ILIKE $${params.length})`);
      }
      const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
      params.push(limit, offset);
      const rows = (await client.query(
        `SELECT ${COLS} FROM vendors ${whereClause}
         ORDER BY name ASC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      )).rows;
      const totalRes = await client.query(
        `SELECT COUNT(*)::int AS c FROM vendors ${whereClause}`,
        params.slice(0, -2)
      );
      return { vendors: rows, total: totalRes.rows[0].c };
    } finally {
      client.release();
    }
  }

  async getById(id) {
    const client = await getPool().connect();
    try {
      return (await client.query(`SELECT ${COLS} FROM vendors WHERE id = $1`, [id])).rows[0] || null;
    } finally {
      client.release();
    }
  }

  async getBySlug(slug) {
    const client = await getPool().connect();
    try {
      return (await client.query(`SELECT ${COLS} FROM vendors WHERE slug = $1`, [slug])).rows[0] || null;
    } finally {
      client.release();
    }
  }

  // Returns { vendor, created: boolean }. Idempotent on slug — if a vendor
  // with the same slug already exists (including soft-deleted ones), it's
  // returned as-is; the caller is responsible for restoring if needed.
  async findOrCreate({ name, slug, website, notes }) {
    if (!name || !name.trim()) {
      throw Object.assign(new Error('name is required (the vendor company name, e.g. "Palo Alto Networks"). This is the global catalog of vendors whose products your accounts run.'), { statusCode: 400 });
    }
    const trimmedName = name.trim();
    const finalSlug = (slug && slug.trim()) || slugify(trimmedName);
    if (!finalSlug) {
      throw Object.assign(new Error(`Could not derive a slug from name "${name}". Slug is normally auto-derived from name (lowercase, hyphens) — if your name is entirely punctuation/whitespace it cannot produce a slug. Supply slug explicitly to override.`), { statusCode: 400 });
    }
    const client = await getPool().connect();
    try {
      const existing = (await client.query(`SELECT ${COLS} FROM vendors WHERE slug = $1`, [finalSlug])).rows[0];
      if (existing) return { vendor: existing, created: false };

      // Trigram fuzzy match — catches "Aruba" vs "Aruba Networks", "Cisco"
      // vs "Cisco Meraki" before they become duplicate vendors. Compares both
      // the raw candidate and a generic-suffix-stripped form so callers don't
      // need to know which corporate suffixes the existing row used.
      const normalized = normalizeVendorName(trimmedName);
      const fuzzy = (await client.query(
        `SELECT ${COLS},
                GREATEST(
                  similarity(lower(name), lower($1)),
                  similarity(lower(name), $2),
                  similarity(lower(slug), lower($1))
                ) AS sim
         FROM vendors
         WHERE deleted_at IS NULL
         ORDER BY sim DESC NULLS LAST
         LIMIT 1`,
        [trimmedName, normalized]
      )).rows[0];
      if (fuzzy && Number(fuzzy.sim) >= FUZZY_THRESHOLD) {
        const { sim, ...vendor } = fuzzy;
        return { vendor, created: false, matched_by: 'fuzzy', match_score: Number(sim) };
      }

      const inserted = await client.query(
        `INSERT INTO vendors (name, slug, website, notes, needs_review)
         VALUES ($1, $2, $3, $4, TRUE)
         RETURNING ${COLS}`,
        [trimmedName, finalSlug, website || null, notes || null]
      );
      return { vendor: inserted.rows[0], created: true };
    } finally {
      client.release();
    }
  }

  async patch(id, data) {
    const client = await getPool().connect();
    try {
      const existing = (await client.query(`SELECT ${COLS} FROM vendors WHERE id = $1`, [id])).rows[0];
      if (!existing) return null;
      const next = {
        name: data.name !== undefined ? (data.name?.trim() || existing.name) : existing.name,
        slug: data.slug !== undefined ? (data.slug?.trim() || existing.slug) : existing.slug,
        website: data.website !== undefined ? data.website : existing.website,
        notes: data.notes !== undefined ? data.notes : existing.notes,
        needs_review: data.needs_review !== undefined ? !!data.needs_review : existing.needs_review,
      };
      if (!next.name) throw Object.assign(new Error('name cannot be empty (whitespace-only). Omit the field to leave existing name unchanged.'), { statusCode: 400 });
      if (!next.slug) throw Object.assign(new Error('slug cannot be empty (whitespace-only). Omit the field to leave existing slug unchanged.'), { statusCode: 400 });
      const updated = await client.query(
        `UPDATE vendors SET name = $2, slug = $3, website = $4, notes = $5, needs_review = $6
         WHERE id = $1
         RETURNING ${COLS}`,
        [id, next.name, next.slug, next.website, next.notes, next.needs_review]
      );
      return updated.rows[0];
    } finally {
      client.release();
    }
  }

  async softDelete(id) {
    const client = await getPool().connect();
    try {
      const updated = await client.query(
        `UPDATE vendors SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING ${COLS}`,
        [id]
      );
      return updated.rows[0] || null;
    } finally {
      client.release();
    }
  }

  async restore(id) {
    const client = await getPool().connect();
    try {
      const updated = await client.query(
        `UPDATE vendors SET deleted_at = NULL WHERE id = $1 RETURNING ${COLS}`,
        [id]
      );
      return updated.rows[0] || null;
    } finally {
      client.release();
    }
  }
}
