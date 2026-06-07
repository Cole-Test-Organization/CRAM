import { getPool } from '../../db/connection.js';
import { slugify } from '../_shared/_slug.js';
import { FUZZY_THRESHOLD, normalizeProductName } from '../_shared/_fuzzy-match.js';
import { badRequest, notFound } from '../../lib/http-error.js';
import type { VendorsService } from './vendors.js';

const COLS = `vp.id, vp.vendor_id, vp.name, vp.slug, vp.category, vp.notes,
              vp.needs_review, vp.deleted_at, vp.created_at, vp.updated_at,
              v.name AS vendor_name, v.slug AS vendor_slug`;

// The per-category bigint[] columns on account_details that reference
// vendor_products.id. Verified to be the ONLY place a product id is referenced
// (no FK tables, no scalar vendor_product_id columns), so a merge repoints
// exactly these. Keep in sync with account_details (migrations 11 / 16 / 24).
const LINK_COLUMNS = [
  'firewall_ids', 'edr_ids', 'siem_ids', 'idp_ids', 'mfa_ids', 'pam_ids',
  'email_security_ids', 'mdr_ids', 'msp_ids', 'sase_ids', 'sdwan_ids',
  'vpn_ids', 'dlp_ids', 'casb_ids', 'vuln_mgmt_ids', 'ticketing_ids',
  'productivity_suite_ids', 'cloud_provider_ids', 'cspm_ids', 'appsec_ids',
  'ndr_ids', 'iot_ot_ids', 'ai_security_ids',
];

// Global catalog — no RLS. Each product belongs to exactly one vendor and has
// a free-text category (firewall, edr, siem, …). The category is what the GUI
// uses to scope picker dropdowns per account_details column.
export class VendorProductsService {
  vendorsService: VendorsService;

  constructor({ vendorsService }: { vendorsService: VendorsService }) {
    this.vendorsService = vendorsService;
  }

  async getAll({ vendor_id, vendor_slug, category, search, include_deleted = false, needs_review, limit, offset = 0 }: { vendor_id?: number; vendor_slug?: string; category?: string; search?: string; include_deleted?: boolean; needs_review?: boolean; limit?: number | null; offset?: number } = {}) {
    const client = await getPool().connect();
    try {
      const params = [];
      const conditions = [];
      if (!include_deleted) conditions.push('vp.deleted_at IS NULL');
      if (vendor_id) {
        params.push(vendor_id);
        conditions.push(`vp.vendor_id = $${params.length}`);
      }
      if (vendor_slug) {
        params.push(vendor_slug);
        conditions.push(`v.slug = $${params.length}`);
      }
      if (category) {
        params.push(category);
        conditions.push(`vp.category = $${params.length}`);
      }
      if (needs_review === true || needs_review === false) {
        params.push(needs_review);
        conditions.push(`vp.needs_review = $${params.length}`);
      }
      if (search) {
        params.push(`%${search}%`);
        conditions.push(`(vp.name ILIKE $${params.length} OR v.name ILIKE $${params.length})`);
      }
      const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
      const baseParams = [...params];
      let paginationSql = '';
      if (limit != null) {
        params.push(limit, offset);
        paginationSql = `LIMIT $${params.length - 1} OFFSET $${params.length}`;
      } else if (offset) {
        params.push(offset);
        paginationSql = `OFFSET $${params.length}`;
      }
      const rows = (await client.query(
        `SELECT ${COLS}
         FROM vendor_products vp
         JOIN vendors v ON v.id = vp.vendor_id
         ${whereClause}
         ORDER BY v.name ASC, vp.name ASC
         ${paginationSql}`,
        params
      )).rows;
      const totalRes = await client.query(
        `SELECT COUNT(*)::int AS c
         FROM vendor_products vp
         JOIN vendors v ON v.id = vp.vendor_id
         ${whereClause}`,
        baseParams
      );
      return { products: rows, total: totalRes.rows[0].c };
    } finally {
      client.release();
    }
  }

  async getById(id: number) {
    const client = await getPool().connect();
    try {
      return (await client.query(
        `SELECT ${COLS} FROM vendor_products vp JOIN vendors v ON v.id = vp.vendor_id WHERE vp.id = $1`,
        [id]
      )).rows[0] || null;
    } finally {
      client.release();
    }
  }

  async getByIds(ids: number[]) {
    if (!ids || ids.length === 0) return [];
    const client = await getPool().connect();
    try {
      return (await client.query(
        `SELECT ${COLS}
         FROM vendor_products vp
         JOIN vendors v ON v.id = vp.vendor_id
         WHERE vp.id = ANY($1::bigint[])`,
        [ids]
      )).rows;
    } finally {
      client.release();
    }
  }

  // Returns { product, created, vendor, vendor_created }. Accepts either
  // vendor_id (existing) or vendor_name (auto-creates via vendorsService).
  async findOrCreate({ vendor_id, vendor_name, name, slug, category, notes }: { vendor_id?: number; vendor_name?: string; name?: string; slug?: string; category?: string; notes?: string | null }) {
    if (!name || !name.trim()) {
      throw badRequest('name is required');
    }
    if (!category || !category.trim()) {
      throw badRequest('category is required (firewall, edr, siem, idp, mfa, pam, email_security, mdr, msp, sase, sdwan, vpn, dlp, casb, vuln_mgmt, ticketing, email_collab, cloud_provider). If you meant to add a product you SELL to an opportunity, use the `products` tool instead — vendor_products is the global catalog of what accounts RUN.');
    }
    if (!vendor_id && !vendor_name) {
      throw badRequest('vendor_id or vendor_name is required (the maker of this product, e.g. "Palo Alto Networks"). If you meant to add a product you SELL to an opportunity, use the `products` tool instead.');
    }

    let vendor;
    let vendorCreated = false;
    if (vendor_id) {
      vendor = await this.vendorsService.getById(vendor_id);
      if (!vendor) {
        throw notFound(`Vendor not found: ${vendor_id}`);
      }
    } else {
      const result = await this.vendorsService.findOrCreate({ name: vendor_name });
      vendor = result.vendor;
      vendorCreated = result.created;
    }

    const trimmedName = name.trim();
    const finalSlug = (slug && slug.trim()) || slugify(trimmedName);
    if (!finalSlug) {
      throw badRequest(`Could not derive a slug from name "${name}". Slug is normally auto-derived (lowercase, hyphens) — if your name is entirely punctuation/whitespace it cannot produce a slug. Supply slug explicitly to override.`);
    }

    const client = await getPool().connect();
    try {
      const existing = (await client.query(
        `SELECT ${COLS}
         FROM vendor_products vp JOIN vendors v ON v.id = vp.vendor_id
         WHERE vp.vendor_id = $1 AND vp.slug = $2`,
        [vendor.id, finalSlug]
      )).rows[0];
      if (existing) {
        return { product: existing, created: false, vendor, vendor_created: vendorCreated };
      }

      // Trigram fuzzy match within the same vendor + category — catches
      // "Meraki" vs "Meraki MX", "CyberArk Identity" vs "Identity", etc.
      // before they become duplicate rows. We compare both the raw candidate
      // and a form that has the vendor prefix + generic suffixes stripped,
      // so e.g. "CyberArk Identity" + vendor CyberArk normalizes to "identity"
      // and matches a pre-existing "Identity" row. Category is part of the
      // filter because CrowdStrike sells the *same* "Falcon" name across EDR
      // and SIEM as distinct products — don't collapse those.
      const normalized = normalizeProductName(trimmedName, vendor.name);
      const fuzzy = (await client.query(
        `SELECT ${COLS},
                GREATEST(
                  similarity(lower(vp.name), lower($1)),
                  similarity(lower(vp.name), $2)
                ) AS sim
         FROM vendor_products vp JOIN vendors v ON v.id = vp.vendor_id
         WHERE vp.vendor_id = $3
           AND vp.category = $4
           AND vp.deleted_at IS NULL
         ORDER BY sim DESC NULLS LAST
         LIMIT 1`,
        [trimmedName, normalized, vendor.id, category.trim()]
      )).rows[0];
      if (fuzzy && Number(fuzzy.sim) >= FUZZY_THRESHOLD) {
        const { sim, ...product } = fuzzy;
        return {
          product,
          created: false,
          vendor,
          vendor_created: vendorCreated,
          matched_by: 'fuzzy',
          match_score: Number(sim),
        };
      }

      const insertedId = (await client.query(
        `INSERT INTO vendor_products (vendor_id, name, slug, category, notes, needs_review)
         VALUES ($1, $2, $3, $4, $5, TRUE)
         RETURNING id`,
        [vendor.id, trimmedName, finalSlug, category.trim(), notes || null]
      )).rows[0].id;
      const product = (await client.query(
        `SELECT ${COLS} FROM vendor_products vp JOIN vendors v ON v.id = vp.vendor_id WHERE vp.id = $1`,
        [insertedId]
      )).rows[0];
      return { product, created: true, vendor, vendor_created: vendorCreated };
    } finally {
      client.release();
    }
  }

  // Reassigning vendor_id would orphan account_details references that
  // implicitly assume "this id is a $vendor product." Block it.
  async patch(id: number, data: Record<string, any>) {
    const client = await getPool().connect();
    try {
      const existing = (await client.query(
        `SELECT ${COLS} FROM vendor_products vp JOIN vendors v ON v.id = vp.vendor_id WHERE vp.id = $1`,
        [id]
      )).rows[0];
      if (!existing) return null;
      if (data.vendor_id !== undefined && Number(data.vendor_id) !== Number(existing.vendor_id)) {
        throw badRequest('Cannot reassign vendor_id on an existing vendor_product — account_details *_ids arrays implicitly assume "this id belongs to that vendor". To switch vendors, soft-delete this row and call find_or_create with the new vendor (or vendor_name).');
      }
      const next = {
        name: data.name !== undefined ? (data.name?.trim() || existing.name) : existing.name,
        slug: data.slug !== undefined ? (data.slug?.trim() || existing.slug) : existing.slug,
        category: data.category !== undefined ? (data.category?.trim() || existing.category) : existing.category,
        notes: data.notes !== undefined ? data.notes : existing.notes,
        needs_review: data.needs_review !== undefined ? !!data.needs_review : existing.needs_review,
      };
      if (!next.name) throw badRequest('name cannot be empty (whitespace-only). Omit the field to leave existing name unchanged.');
      if (!next.slug) throw badRequest('slug cannot be empty (whitespace-only). Omit the field to leave existing slug unchanged.');
      if (!next.category) throw badRequest('category cannot be empty (whitespace-only). Valid categories: firewall, edr, siem, idp, mfa, pam, email_security, mdr, msp, sase, sdwan, vpn, dlp, casb, vuln_mgmt, ticketing, email_collab, cloud_provider. Omit to leave unchanged.');
      await client.query(
        `UPDATE vendor_products SET name = $2, slug = $3, category = $4, notes = $5, needs_review = $6
         WHERE id = $1`,
        [id, next.name, next.slug, next.category, next.notes, next.needs_review]
      );
      return (await client.query(
        `SELECT ${COLS} FROM vendor_products vp JOIN vendors v ON v.id = vp.vendor_id WHERE vp.id = $1`,
        [id]
      )).rows[0];
    } finally {
      client.release();
    }
  }

  async softDelete(id: number) {
    const client = await getPool().connect();
    try {
      const updated = await client.query(
        `UPDATE vendor_products SET deleted_at = NOW()
         WHERE id = $1 AND deleted_at IS NULL`,
        [id]
      );
      if (updated.rowCount === 0) return null;
      return (await client.query(
        `SELECT ${COLS} FROM vendor_products vp JOIN vendors v ON v.id = vp.vendor_id WHERE vp.id = $1`,
        [id]
      )).rows[0];
    } finally {
      client.release();
    }
  }

  async restore(id: number) {
    const client = await getPool().connect();
    try {
      await client.query(`UPDATE vendor_products SET deleted_at = NULL WHERE id = $1`, [id]);
      return (await client.query(
        `SELECT ${COLS} FROM vendor_products vp JOIN vendors v ON v.id = vp.vendor_id WHERE vp.id = $1`,
        [id]
      )).rows[0] || null;
    } finally {
      client.release();
    }
  }

  // Merge `loserId` into `winnerId`: repoint every account_details *_ids array
  // that references the loser to the winner (de-duplicated, first-occurrence
  // order preserved), then soft-delete the loser. Same-category only — the
  // arrays are per-category, so a cross-category merge would file the surviving
  // id under the wrong column. Transactional, with a post-check that refuses to
  // soft-delete while any reference to the loser remains, so we never orphan.
  //
  // account_details has RLS ENABLED but not FORCED (migration 11 vs 3), so the
  // table-owner pool role bypasses the per-user policy and this repoints across
  // every tenant — correct for a globally-shared catalog.
  async merge(winnerId: number | string, loserId: number | string) {
    const wId = Number(winnerId);
    const lId = Number(loserId);
    if (!wId || !lId) throw badRequest('merge requires numeric winner_id and loser_id. The winner survives as the canonical row; the loser is repointed and soft-deleted.');
    if (wId === lId) throw badRequest('winner_id and loser_id must differ — cannot merge a product into itself.');
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const fetch = async (pid: number) => (await client.query(
        `SELECT ${COLS} FROM vendor_products vp JOIN vendors v ON v.id = vp.vendor_id WHERE vp.id = $1`,
        [pid]
      )).rows[0];
      const winner = await fetch(wId);
      const loser = await fetch(lId);
      if (!winner) throw notFound(`Winner vendor_product not found: id=${wId}`);
      if (!loser) throw notFound(`Loser vendor_product not found: id=${lId}`);
      if (winner.deleted_at) throw badRequest(`Winner id=${wId} is soft-deleted — restore it first, or pick a live winner.`);
      if (winner.category !== loser.category) {
        throw badRequest(`Refusing to merge across categories (winner="${winner.category}", loser="${loser.category}"). account_details references are per-category bigint[] columns; merging across would file the surviving id under the wrong column. Recategorize one of them first if they're truly the same product.`);
      }

      let accountsRepointed = 0;
      for (const col of LINK_COLUMNS) {
        const res = await client.query(
          `UPDATE account_details
           SET ${col} = (
             SELECT COALESCE(array_agg(e ORDER BY ord), '{}'::bigint[])
             FROM (
               SELECT e, MIN(ord) AS ord
               FROM unnest(array_replace(${col}, $1, $2)) WITH ORDINALITY AS u(e, ord)
               GROUP BY e
             ) d
           )
           WHERE $1 = ANY(${col})`,
          [lId, wId]
        );
        accountsRepointed += res.rowCount ?? 0;
      }

      // Fail-safe: never soft-delete while a reference to the loser survives
      // (e.g. if RLS had silently filtered the UPDATE). Roll back, don't orphan.
      const stillReferenced = await client.query(
        `SELECT 1 FROM account_details
         WHERE ${LINK_COLUMNS.map((c) => `$1 = ANY(${c})`).join(' OR ')}
         LIMIT 1`,
        [lId]
      );
      if ((stillReferenced.rowCount ?? 0) > 0) {
        throw new Error('merge aborted: loser still referenced after repoint — rolled back, nothing changed (check that the DB role bypasses account_details RLS).');
      }

      await client.query(`UPDATE vendor_products SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`, [lId]);
      await client.query('COMMIT');
      return { winner, loser, accounts_repointed: accountsRepointed };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
