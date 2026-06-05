import { withUser } from '../../db/connection.js';
import { slugify } from '../_shared/_slug.js';
import { jsonb } from '../_shared/_json.js';
import { normalizeDomain } from '../_shared/_domain.js';
import { badRequest, notFound, conflict } from '../../lib/http-error.js';

const ACCOUNT_COLS = `
  id, slug, name, status, last_contact,
  relationship_summary,
  active_deals, domains,
  favorite, needs_review,
  created_at, updated_at
`;

// Normalize a user-supplied domains array: clean + dedupe each entry.
// null → null (caller treats as "field omitted"); non-array → [] (clear it).
function normalizeDomains(input) {
  if (input == null) return null;
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  for (const raw of input) {
    const d = normalizeDomain(raw);
    if (d) seen.add(d);
  }
  return [...seen];
}

// findOrCreate fuzzy-name thresholds. Auto-link only on an exact signal
// (slug / domain / exact name) or a near-exact fuzzy name (>= AUTOLINK); names
// scoring in [SUGGEST, AUTOLINK) come back as triage candidates rather than
// being silently merged — a wrong account merge is expensive to undo. Below
// SUGGEST nothing is proposed. Tunable via env; keep SUGGEST >= pg_trgm's
// default similarity_threshold (0.3) so the index-backed `%` prefilter never
// hides a candidate that would clear it.
const ACCOUNT_AUTOLINK_THRESHOLD = Number(process.env.ACCOUNT_AUTOLINK_THRESHOLD) || 0.85;
const ACCOUNT_SUGGEST_THRESHOLD = Number(process.env.ACCOUNT_SUGGEST_THRESHOLD) || 0.4;

export class AccountsService {
  async getAllSlugs(userId) {
    return withUser(userId, async (client) => {
      const rows = (await client.query(
        `SELECT slug FROM accounts ORDER BY slug ASC`
      )).rows;
      return rows.map(r => r.slug);
    });
  }

  async getAll(userId, { status, exclude_status, needs_review, sort = 'name', order = 'asc', limit, offset = 0 } = {}) {
    return withUser(userId, async (client) => {
      const validSorts = ['name', 'slug', 'status', 'last_contact', 'created_at', 'updated_at'];
      const sortCol = validSorts.includes(sort) ? sort : 'name';
      const sortOrder = order === 'desc' ? 'DESC' : 'ASC';

      const params = [];
      const conditions = [];
      if (status) {
        params.push(status);
        conditions.push(`LOWER(a.status) = LOWER($${params.length})`);
      }
      if (exclude_status) {
        params.push(exclude_status);
        conditions.push(`(a.status IS NULL OR LOWER(a.status) <> LOWER($${params.length}))`);
      }
      if (needs_review === true)  conditions.push('a.needs_review = true');
      if (needs_review === false) conditions.push('a.needs_review = false');
      const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

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
        `SELECT ${ACCOUNT_COLS.split(',').map(c => `a.${c.trim()}`).join(', ')},
                (SELECT COUNT(*)::int FROM account_contacts ac
                   JOIN contacts c ON c.id = ac.contact_id
                  WHERE ac.account_id = a.id AND c.kind <> 'internal') AS contact_count,
                (SELECT COUNT(*)::int FROM meetings WHERE account_id = a.id) AS meeting_count
         FROM accounts a
         ${whereClause}
         ORDER BY a.favorite DESC, a.${sortCol} ${sortOrder}
         ${paginationSql}`,
        params
      )).rows;

      const countRes = await client.query(
        `SELECT COUNT(*)::int AS count FROM accounts a ${whereClause}`,
        baseParams
      );

      return { accounts: rows, total: countRes.rows[0].count };
    });
  }

  async getById(userId, id) {
    return withUser(userId, (client) => this._fetchWithChildren(client, 'id', id));
  }

  async getBySlug(userId, slug) {
    if (typeof slug !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
      throw badRequest(`"${slug}" is not a slug shape. Slugs are lowercase-hyphenated alphanumeric (e.g. "acme-manufacturing", "fixturecorp-test"). If you only have a company name, call the search tool with type="accounts" to fuzzy-match it.`);
    }
    return withUser(userId, (client) => this._fetchWithChildren(client, 'slug', slug));
  }

  async getByDomain(userId, domain) {
    return withUser(userId, async (client) => {
      const [normalized] = normalizeDomains([domain]);
      if (!normalized || !normalized.includes('.')) {
        throw badRequest(`"${domain}" is not a domain (must contain "."). Use a real domain like "acme.com", or look the account up by slug or with the search tool (type="accounts") if you only have the company name.`);
      }
      const row = (await client.query(
        `SELECT id FROM accounts WHERE domains @> jsonb_build_array($1::text) ORDER BY id LIMIT 1`,
        [normalized]
      )).rows[0];
      if (!row) return null;
      return this._fetchWithChildren(client, 'id', row.id);
    });
  }

  // Slim domain lookup for staging flows (resolve_emails): account identity
  // only — NOT _fetchWithChildren's contacts/meetings/partners/opportunities
  // fan-out, which on a large account bloats the response by orders of
  // magnitude and, duplicated per attendee via account_match, has blown out
  // agent context windows. Returns null when no account owns the domain.
  async getByDomainBrief(userId, domain) {
    return withUser(userId, async (client) => {
      const [normalized] = normalizeDomains([domain]);
      if (!normalized || !normalized.includes('.')) return null;
      const row = (await client.query(
        `SELECT id, slug, name, status FROM accounts WHERE domains @> jsonb_build_array($1::text) ORDER BY id LIMIT 1`,
        [normalized]
      )).rows[0];
      return row || null;
    });
  }

  // Dedupe lookup: slug match wins (the DB-unique key); falls back to a
  // matching domain in the jsonb domains array, then a case-insensitive name
  // match. Returns { id } or null. Internal — runs inside the caller's
  // transaction. Use findExisting() for a standalone, RLS-scoped call that
  // also enriches with contacts/meetings/partners/opportunities.
  async _findExisting(client, data) {
    if (!data) return null;
    if (typeof data.slug === 'string' && data.slug.trim()) {
      const row = (await client.query(
        `SELECT id FROM accounts WHERE slug = $1 LIMIT 1`,
        [data.slug.trim()]
      )).rows[0];
      if (row) return row;
    }
    if (Array.isArray(data.domains) && data.domains.length > 0) {
      const normalized = normalizeDomains(data.domains);
      for (const d of normalized) {
        const row = (await client.query(
          `SELECT id FROM accounts WHERE domains @> jsonb_build_array($1::text) ORDER BY id LIMIT 1`,
          [d]
        )).rows[0];
        if (row) return row;
      }
    }
    if (typeof data.name === 'string' && data.name.trim()) {
      const row = (await client.query(
        `SELECT id FROM accounts WHERE LOWER(name) = LOWER($1) ORDER BY id LIMIT 1`,
        [data.name.trim()]
      )).rows[0];
      if (row) return row;
    }
    return null;
  }

  async findExisting(userId, data) {
    return withUser(userId, async (client) => {
      const existing = await this._findExisting(client, data);
      if (!existing) return null;
      return this._fetchWithChildren(client, 'id', existing.id);
    });
  }

  // Classify whether `data` (name / slug / domains) refers to an existing
  // account — for the notes-import pipeline and the in-app agent. Unlike
  // create() (which throws 409 on any match), this returns a decision the
  // caller acts on, and never silently merges a weak fuzzy match:
  //
  //   'matched'   — an exact signal (slug, domain, exact name) or a near-exact
  //                 fuzzy name (>= AUTOLINK). `account` is enriched; `matched_by`
  //                 names the signal and `match_score` is set for fuzzy.
  //   'ambiguous' — fuzzy name(s) in [SUGGEST, AUTOLINK). `candidates` is the
  //                 ranked shortlist for one-click triage; nothing is written.
  //   'none'      — no candidate clears SUGGEST.
  //   'created'   — only with opts.createIfMissing when the result would be
  //                 'none': a fresh account is inserted and returned enriched.
  //
  // opts.fuzzy=false restricts to the exact tiers (used by bundle import, where
  // the slug is the identity and a fuzzy auto-merge would be wrong).
  async findOrCreate(userId, data = {}, { createIfMissing = false, fuzzy = true } = {}) {
    return withUser(userId, async (client) => {
      const name = (data.name || '').trim();
      const slug = (data.slug || '').trim();
      const domains = normalizeDomains(data.domains);

      // Exact tiers (definite match): slug → domain → exact name.
      if (slug) {
        const row = (await client.query('SELECT id FROM accounts WHERE slug = $1 LIMIT 1', [slug])).rows[0];
        if (row) return { status: 'matched', matched_by: 'slug', account: await this._fetchWithChildren(client, 'id', row.id) };
      }
      if (domains && domains.length) {
        for (const d of domains) {
          const row = (await client.query(
            'SELECT id FROM accounts WHERE domains @> jsonb_build_array($1::text) ORDER BY id LIMIT 1',
            [d]
          )).rows[0];
          if (row) return { status: 'matched', matched_by: 'domain', account: await this._fetchWithChildren(client, 'id', row.id) };
        }
      }
      if (name) {
        const row = (await client.query('SELECT id FROM accounts WHERE LOWER(name) = LOWER($1) ORDER BY id LIMIT 1', [name])).rows[0];
        if (row) return { status: 'matched', matched_by: 'name', account: await this._fetchWithChildren(client, 'id', row.id) };
      }

      // Fuzzy name tier — the `%` prefilter is served by idx_accounts_name_trgm,
      // then the app-level thresholds decide auto-link vs. triage vs. nothing.
      if (fuzzy && name) {
        const cands = (await client.query(
          `SELECT id, slug, name, status, similarity(lower(name), lower($1)) AS sim
             FROM accounts
            WHERE lower(name) % lower($1)
            ORDER BY sim DESC NULLS LAST
            LIMIT 5`,
          [name]
        )).rows;
        if (cands[0] && Number(cands[0].sim) >= ACCOUNT_AUTOLINK_THRESHOLD) {
          return {
            status: 'matched', matched_by: 'fuzzy', match_score: Number(cands[0].sim),
            account: await this._fetchWithChildren(client, 'id', cands[0].id),
          };
        }
        const candidates = cands
          .filter((c) => Number(c.sim) >= ACCOUNT_SUGGEST_THRESHOLD)
          .map((c) => ({ id: c.id, slug: c.slug, name: c.name, status: c.status, score: Number(c.sim) }));
        if (candidates.length) return { status: 'ambiguous', candidates, account: null };
      }

      if (!createIfMissing) return { status: 'none', account: null };

      // Create. Guard a derived-slug collision (same company, name cased
      // differently) so we return the match instead of tripping the unique key.
      const finalSlug = slug || slugify(name);
      if (!finalSlug) {
        throw badRequest(`Could not derive a slug for the new account (name="${data.name}"). Supply slug explicitly.`);
      }
      const collision = (await client.query('SELECT id FROM accounts WHERE slug = $1 LIMIT 1', [finalSlug])).rows[0];
      if (collision) return { status: 'matched', matched_by: 'slug', account: await this._fetchWithChildren(client, 'id', collision.id) };

      const status = (data.status && data.status.trim()) || 'account';
      // Auto-created via the classifier → flag for review. The caller reached
      // findOrCreate because it wasn't sure this account existed; a freshly
      // minted row from that path is unverified by definition, so surface it in
      // the accounts review queue rather than letting it look hand-curated.
      const inserted = await client.query(
        `INSERT INTO accounts (user_id, slug, name, status, domains, needs_review)
         VALUES (current_setting('app.current_user_id')::bigint, $1, $2, $3, coalesce($4, '[]'::jsonb), true)
         RETURNING id`,
        [finalSlug, name || finalSlug, status, jsonb(domains)]
      );
      return { status: 'created', account: await this._fetchWithChildren(client, 'id', inserted.rows[0].id) };
    });
  }

  async _fetchWithChildren(client, key, value) {
    const row = (await client.query(
      `SELECT ${ACCOUNT_COLS} FROM accounts WHERE ${key} = $1`,
      [value]
    )).rows[0];
    if (!row) return null;

    // Two faces of account_contacts, split by the contact's kind:
    //   contacts — external people AT the account (kind account/partner)
    //   team     — the user's own teammates (kind=internal) SUPPORTING the
    //              account. Same join table; the kind discriminates. Keeping
    //              them apart means teammates never show up as customer contacts
    //              (or inflate the contact count) but are still visible as the
    //              supporting SE team on the account overview.
    const contacts = (await client.query(
      `SELECT c.id, c.full_name, c.company, c.title, c.email, c.phone, c.linkedin, c.notes, c.kind, c.created_at, c.updated_at
       FROM contacts c
       JOIN account_contacts ac ON ac.contact_id = c.id
       WHERE ac.account_id = $1 AND c.kind <> 'internal'
       ORDER BY c.full_name`,
      [row.id]
    )).rows;

    const team = (await client.query(
      `SELECT c.id, c.full_name, c.company, c.title, c.email, c.phone, c.linkedin, c.notes, c.kind, c.created_at, c.updated_at
       FROM contacts c
       JOIN account_contacts ac ON ac.contact_id = c.id
       WHERE ac.account_id = $1 AND c.kind = 'internal'
       ORDER BY c.full_name`,
      [row.id]
    )).rows;

    const meetings = (await client.query(
      `SELECT id, date, title, filename, created_at
       FROM meetings
       WHERE account_id = $1
       ORDER BY date DESC`,
      [row.id]
    )).rows;

    const partners = (await client.query(
      `SELECT a.id, a.slug, a.name, a.status
       FROM account_partners ap
       JOIN accounts a ON a.id = ap.partner_account_id
       WHERE ap.customer_account_id = $1
       ORDER BY a.name`,
      [row.id]
    )).rows;

    const opportunities = (await client.query(
      `SELECT o.id, o.name, o.stage, o.opp_link, o.trr_link, o.tech_validation_link,
              o.created_at, o.updated_at,
              (SELECT COUNT(*)::int FROM opp_products WHERE opportunity_id = o.id) AS product_count
       FROM opportunities o
       WHERE o.account_id = $1
       ORDER BY o.created_at DESC`,
      [row.id]
    )).rows;

    const { c: open_thread_count } = (await client.query(
      `SELECT COUNT(*)::int AS c FROM threads WHERE account_id = $1 AND closed_at IS NULL`,
      [row.id]
    )).rows[0];

    return { ...row, contacts, team, meetings, partners, opportunities, open_thread_count };
  }

  async create(userId, data) {
    return withUser(userId, async (client) => {
      const dup = await this._findExisting(client, data);
      if (dup) {
        const enriched = await this._fetchWithChildren(client, 'id', dup.id);
        const matchedBy =
          data.slug && enriched?.slug === data.slug ? 'slug'
            : (Array.isArray(data.domains) && data.domains.length > 0) ? 'domain'
            : 'name';
        throw Object.assign(
          conflict(`Account already exists (matched on ${matchedBy}): id=${dup.id}, slug="${enriched?.slug}", name="${enriched?.name}". Update via PATCH /api/accounts/${dup.id} (or the accounts MCP tool with action="update") instead of creating a duplicate.`),
          { existing: enriched }
        );
      }
      // Default new rows to 'account'. The status taxonomy is a binary
      // partner-vs-account split — everything that isn't a channel partner is
      // just an account, no prospect or sub-state.
      const status = (data.status && data.status.trim()) || 'account';
      const inserted = await client.query(
        `INSERT INTO accounts (
           user_id, slug, name, status, last_contact,
           relationship_summary,
           active_deals, domains, favorite, needs_review
         ) VALUES (
           current_setting('app.current_user_id')::bigint,
           $1, $2, $3, $4, $5, $6, coalesce($7, '[]'::jsonb), coalesce($8, false), coalesce($9, false)
         ) RETURNING id`,
        [
          data.slug || null,
          data.name || null,
          status,
          data.last_contact || null,
          data.relationship_summary || null,
          data.active_deals || null,
          jsonb(normalizeDomains(data.domains)),
          typeof data.favorite === 'boolean' ? data.favorite : null,
          typeof data.needs_review === 'boolean' ? data.needs_review : null,
        ]
      );
      return this._fetchWithChildren(client, 'id', inserted.rows[0].id);
    });
  }

  async update(userId, id, data) {
    return withUser(userId, async (client) => {
      const existing = (await client.query(
        `SELECT ${ACCOUNT_COLS} FROM accounts WHERE id = $1`,
        [id]
      )).rows[0];
      if (!existing) return null;

      await client.query(
        `UPDATE accounts SET
           slug = $2, name = $3, status = $4, last_contact = $5,
           relationship_summary = $6,
           active_deals = $7, domains = coalesce($8, '[]'::jsonb),
           favorite = coalesce($9, false), needs_review = coalesce($10, false)
         WHERE id = $1`,
        [
          id,
          data.slug || null,
          data.name || null,
          data.status || null,
          data.last_contact || null,
          data.relationship_summary || null,
          data.active_deals || null,
          jsonb(normalizeDomains(data.domains)),
          typeof data.favorite === 'boolean' ? data.favorite : null,
          typeof data.needs_review === 'boolean' ? data.needs_review : null,
        ]
      );
      return this._fetchWithChildren(client, 'id', id);
    });
  }

  async patch(userId, id, data) {
    return withUser(userId, async (client) => {
      const existing = (await client.query(
        `SELECT ${ACCOUNT_COLS} FROM accounts WHERE id = $1`,
        [id]
      )).rows[0];
      if (!existing) return null;

      const updates = {
        slug: data.slug !== undefined ? data.slug : existing.slug,
        name: data.name !== undefined ? data.name : existing.name,
        status: data.status !== undefined ? data.status : existing.status,
        last_contact: data.last_contact !== undefined ? data.last_contact : existing.last_contact,
        relationship_summary: data.relationship_summary !== undefined ? data.relationship_summary : existing.relationship_summary,
        active_deals: data.active_deals !== undefined ? data.active_deals : existing.active_deals,
        domains: data.domains !== undefined ? normalizeDomains(data.domains) : existing.domains,
        favorite: data.favorite !== undefined ? !!data.favorite : existing.favorite,
        needs_review: data.needs_review !== undefined ? !!data.needs_review : existing.needs_review,
      };

      await client.query(
        `UPDATE accounts SET
           slug = $2, name = $3, status = $4, last_contact = $5,
           relationship_summary = $6,
           active_deals = $7, domains = coalesce($8, '[]'::jsonb),
           favorite = $9, needs_review = $10
         WHERE id = $1`,
        [
          id,
          updates.slug || null,
          updates.name || null,
          updates.status || null,
          updates.last_contact || null,
          updates.relationship_summary || null,
          updates.active_deals || null,
          jsonb(updates.domains),
          !!updates.favorite,
          !!updates.needs_review,
        ]
      );
      return this._fetchWithChildren(client, 'id', id);
    });
  }

  async delete(userId, id) {
    return withUser(userId, async (client) => {
      const existing = (await client.query(
        'SELECT slug FROM accounts WHERE id = $1',
        [id]
      )).rows[0];
      if (!existing) return null;

      // Contacts are M:N with accounts via account_contacts. Deleting the
      // account only cascades the junction rows — the contacts themselves
      // stay, which leaves orphans behind when a contact was only ever
      // linked to this one account. Sweep those up here so the common case
      // ("I'm done with this customer") doesn't require a follow-up cleanup.
      // Partner/internal contacts are deliberately preserved: they have
      // independent meaning even when their only account link disappears.
      const orphaned = (await client.query(
        `SELECT c.id
         FROM contacts c
         JOIN account_contacts ac ON ac.contact_id = c.id
         WHERE ac.account_id = $1
           AND c.kind = 'account'
           AND NOT EXISTS (
             SELECT 1 FROM account_contacts ac2
             WHERE ac2.contact_id = c.id AND ac2.account_id <> $1
           )`,
        [id]
      )).rows.map((r) => r.id);

      if (orphaned.length) {
        await client.query(
          'DELETE FROM contacts WHERE id = ANY($1::bigint[])',
          [orphaned]
        );
      }

      await client.query('DELETE FROM accounts WHERE id = $1', [id]);
      return { ...existing, deleted_contact_ids: orphaned, deleted_contact_count: orphaned.length };
    });
  }

  async listPartners(userId, customerAccountId) {
    return withUser(userId, async (client) => {
      return (await client.query(
        `SELECT a.id, a.slug, a.name, a.status, a.last_contact,
                (SELECT COUNT(*)::int FROM account_contacts ac
                   JOIN contacts c ON c.id = ac.contact_id
                  WHERE ac.account_id = a.id AND c.kind <> 'internal') AS contact_count
         FROM account_partners ap
         JOIN accounts a ON a.id = ap.partner_account_id
         WHERE ap.customer_account_id = $1
         ORDER BY a.name`,
        [customerAccountId]
      )).rows;
    });
  }

  async addPartner(userId, customerAccountId, partnerAccountId) {
    return withUser(userId, async (client) => {
      if (Number(customerAccountId) === Number(partnerAccountId)) {
        throw badRequest('An account cannot be its own partner');
      }
      const both = (await client.query(
        'SELECT id FROM accounts WHERE id = ANY($1::bigint[])',
        [[customerAccountId, partnerAccountId]]
      )).rows;
      if (both.length !== 2) {
        throw notFound('One or both accounts not found');
      }
      await client.query(
        'INSERT INTO account_partners (customer_account_id, partner_account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [customerAccountId, partnerAccountId]
      );
      return this.listPartners(userId, customerAccountId);
    });
  }

  async removePartner(userId, customerAccountId, partnerAccountId) {
    return withUser(userId, async (client) => {
      await client.query(
        'DELETE FROM account_partners WHERE customer_account_id = $1 AND partner_account_id = $2',
        [customerAccountId, partnerAccountId]
      );
      return this.listPartners(userId, customerAccountId);
    });
  }
}
