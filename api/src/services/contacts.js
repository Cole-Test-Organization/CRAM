import { withUser } from '../db/connection.js';
import { badRequest, conflict } from '../lib/http-error.js';

const CONTACT_COLS = 'id, full_name, company, title, email, phone, linkedin, notes, kind, location_raw, city, state, country, created_at, updated_at';
const VALID_KINDS = new Set(['account', 'partner', 'internal']);

// findOrCreate fuzzy-name threshold. Higher than the vendor catalog's 0.4
// because person names are short and a false merge (treating two different
// people as one) is costly — we only want to absorb typos / spacing /
// punctuation variants. Tunable via env. Keep it >= pg_trgm's default
// similarity_threshold (0.3) so the index-backed `%` prefilter never hides a
// row that would otherwise clear this threshold.
const CONTACT_FUZZY_THRESHOLD = Number(process.env.CONTACT_FUZZY_THRESHOLD) || 0.55;

function normalizeKind(kind) {
  if (kind == null) return undefined;
  // Back-compat alias: callers passing the legacy 'customer' value get the
  // new canonical 'account' kind.
  if (kind === 'customer') return 'account';
  if (!VALID_KINDS.has(kind)) {
    throw badRequest(`Invalid kind: "${kind}". Must be one of: "account" (works at a non-partner account — link to that account), "partner" (channel/reseller rep — link to a partner account), "internal" (teammate at your own company — no account link). Default is "account" if omitted.`);
  }
  return kind;
}

export class ContactsService {
  async getAll(userId, { company, search, kind, city, country, limit = 200, offset = 0 } = {}) {
    return withUser(userId, async (client) => {
      const params = [];
      const conditions = [];
      let joinClause = '';

      if (company) {
        joinClause = 'JOIN account_contacts ac ON ac.contact_id = c.id JOIN accounts a ON a.id = ac.account_id';
        params.push(company);
        conditions.push(`a.slug = $${params.length}`);
      }
      if (search) {
        params.push(`%${search}%`);
        const p = params.length;
        conditions.push(`(c.full_name ILIKE $${p} OR c.email ILIKE $${p} OR c.company ILIKE $${p} OR c.title ILIKE $${p})`);
      }
      if (kind) {
        params.push(normalizeKind(kind));
        conditions.push(`c.kind = $${params.length}`);
      }
      if (city) {
        params.push(city);
        conditions.push(`LOWER(c.city) = LOWER($${params.length})`);
      }
      if (country) {
        params.push(country);
        conditions.push(`LOWER(c.country) = LOWER($${params.length})`);
      }

      const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
      params.push(limit, offset);
      const sql = `
        SELECT DISTINCT ${CONTACT_COLS.split(',').map(c => `c.${c.trim()}`).join(', ')},
          (SELECT string_agg(a2.name, ', ')
           FROM account_contacts ac2 JOIN accounts a2 ON a2.id = ac2.account_id
           WHERE ac2.contact_id = c.id) AS account_names,
          (SELECT string_agg(a2.slug, ',')
           FROM account_contacts ac2 JOIN accounts a2 ON a2.id = ac2.account_id
           WHERE ac2.contact_id = c.id) AS account_slugs
        FROM contacts c
        ${joinClause}
        ${whereClause}
        ORDER BY c.full_name
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `;
      return (await client.query(sql, params)).rows;
    });
  }

  async getCompanies(userId) {
    return withUser(userId, async (client) => {
      const result = await client.query(`
        SELECT a.slug, a.name, COUNT(ac.contact_id)::int AS contact_count
        FROM account_contacts ac
        JOIN accounts a ON a.id = ac.account_id
        GROUP BY a.id
        ORDER BY a.name
      `);
      return result.rows;
    });
  }

  async getByAccount(userId, accountId) {
    return withUser(userId, async (client) => {
      const result = await client.query(`
        SELECT ${CONTACT_COLS.split(',').map(c => `c.${c.trim()}`).join(', ')}
        FROM contacts c
        JOIN account_contacts ac ON ac.contact_id = c.id
        WHERE ac.account_id = $1
        ORDER BY c.full_name
      `, [accountId]);
      return result.rows;
    });
  }

  async getById(userId, id) {
    return withUser(userId, (client) => this._fetchWithAccounts(client, id));
  }

  async getByEmail(userId, email) {
    if (!email || typeof email !== 'string') return null;
    const normalized = email.trim().toLowerCase();
    if (!normalized) return null;
    return withUser(userId, async (client) => {
      const row = (await client.query(
        `SELECT id FROM contacts WHERE LOWER(email) = $1 ORDER BY id LIMIT 1`,
        [normalized]
      )).rows[0];
      if (!row) return null;
      return this._fetchWithAccounts(client, row.id);
    });
  }

  // Buckets for the meeting/internal-note attendee picker.
  //   mode='external' + accountId: account (that account's contacts) + partner
  //     (contacts at partner accounts linked via account_partners) + internal (all)
  //   mode='internal' (no accountId): partner (all partner contacts) + internal (all)
  async getAttendeeOptions(userId, { mode, accountId } = {}) {
    return withUser(userId, async (client) => {
      const colList = CONTACT_COLS.split(',').map(c => `c.${c.trim()}`).join(', ');

      if (mode === 'external') {
        if (!accountId) {
          throw badRequest('accountId is required for mode="external" (returns attendee buckets scoped to one account meeting). Resolve the account via the accounts tool first. For mode="internal" (an internal-only note), accountId is not needed.');
        }
        const account = (await client.query(`
          SELECT ${colList}
          FROM contacts c
          JOIN account_contacts ac ON ac.contact_id = c.id
          WHERE ac.account_id = $1 AND c.kind = 'account'
          ORDER BY c.full_name
        `, [accountId])).rows;

        const partner = (await client.query(`
          SELECT DISTINCT ${colList}, pa.name AS partner_account_name, pa.slug AS partner_account_slug
          FROM contacts c
          JOIN account_contacts ac ON ac.contact_id = c.id
          JOIN account_partners ap ON ap.partner_account_id = ac.account_id
          JOIN accounts pa ON pa.id = ac.account_id
          WHERE ap.customer_account_id = $1 AND c.kind = 'partner'
          ORDER BY c.full_name
        `, [accountId])).rows;

        const internal = (await client.query(`
          SELECT ${colList}
          FROM contacts c
          WHERE c.kind = 'internal'
          ORDER BY c.full_name
        `)).rows;

        return { account, partner, internal };
      }

      // internal mode
      const partner = (await client.query(`
        SELECT DISTINCT ${colList},
          (SELECT a2.name FROM account_contacts ac2
             JOIN accounts a2 ON a2.id = ac2.account_id
             WHERE ac2.contact_id = c.id LIMIT 1) AS partner_account_name,
          (SELECT a2.slug FROM account_contacts ac2
             JOIN accounts a2 ON a2.id = ac2.account_id
             WHERE ac2.contact_id = c.id LIMIT 1) AS partner_account_slug
        FROM contacts c
        WHERE c.kind = 'partner'
        ORDER BY c.full_name
      `)).rows;

      const internal = (await client.query(`
        SELECT ${colList}
        FROM contacts c
        WHERE c.kind = 'internal'
        ORDER BY c.full_name
      `)).rows;

      return { partner, internal };
    });
  }

  // Dedupe lookup: case-insensitive email match wins; falls back to
  // (full_name, kind). Returns { id } or null. Internal — runs inside the
  // caller's transaction. Use findExisting() for a standalone, RLS-scoped call
  // that also enriches with linked accounts.
  async _findExisting(client, data) {
    if (!data) return null;
    if (typeof data.email === 'string') {
      const normalized = data.email.trim().toLowerCase();
      if (normalized) {
        const row = (await client.query(
          `SELECT id FROM contacts WHERE LOWER(email) = $1 ORDER BY id LIMIT 1`,
          [normalized]
        )).rows[0];
        if (row) return row;
      }
    }
    if (typeof data.full_name === 'string') {
      const trimmed = data.full_name.trim();
      if (trimmed) {
        const kind = data.kind ? normalizeKind(data.kind) || 'account' : 'account';
        const row = (await client.query(
          `SELECT id FROM contacts WHERE full_name = $1 AND kind = $2 ORDER BY id LIMIT 1`,
          [trimmed, kind]
        )).rows[0];
        if (row) return row;
      }
    }
    return null;
  }

  async findExisting(userId, data) {
    return withUser(userId, async (client) => {
      const existing = await this._findExisting(client, data);
      if (!existing) return null;
      return this._fetchWithAccounts(client, existing.id);
    });
  }

  async _fetchWithAccounts(client, id) {
    const contact = (await client.query(
      `SELECT ${CONTACT_COLS} FROM contacts WHERE id = $1`,
      [id]
    )).rows[0];
    if (!contact) return null;

    const accounts = (await client.query(`
      SELECT a.id, a.name, a.slug
      FROM account_contacts ac
      JOIN accounts a ON a.id = ac.account_id
      WHERE ac.contact_id = $1
      ORDER BY a.name
    `, [id])).rows;

    return { ...contact, accounts };
  }

  async create(userId, data, accountId) {
    return withUser(userId, async (client) => {
      const kind = normalizeKind(data.kind) || 'account';
      const dup = await this._findExisting(client, { ...data, kind });
      if (dup) {
        const enriched = await this._fetchWithAccounts(client, dup.id);
        const matchedBy = data.email && enriched?.email && enriched.email.toLowerCase() === String(data.email).trim().toLowerCase()
          ? 'email'
          : 'full_name+kind';
        throw Object.assign(
          conflict(`Contact already exists (matched on ${matchedBy}): id=${dup.id}, name="${enriched?.full_name}"${enriched?.email ? `, email="${enriched.email}"` : ''}. Update the existing contact via PATCH /api/contacts/${dup.id} (or the contacts MCP tool with action="update"), or link it to a new account via POST /api/contacts/${dup.id}/accounts/:accountId (action="link_account").`),
          { existing: enriched }
        );
      }
      return this._insert(client, data, kind, accountId);
    });
  }

  // Shared INSERT used by create() and findOrCreate(). Assumes the caller has
  // already validated/normalized `kind` and decided no dedupe match applies.
  async _insert(client, data, kind, accountId) {
    const result = await client.query(
      `INSERT INTO contacts (user_id, full_name, company, title, email, phone, linkedin, notes, kind,
                             location_raw, city, state, country)
       VALUES (current_setting('app.current_user_id')::bigint, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        data.full_name,
        data.company || null,
        data.title || null,
        data.email || null,
        data.phone || null,
        data.linkedin || null,
        data.notes || null,
        kind,
        data.location_raw || null,
        data.city || null,
        data.state || null,
        data.country || null,
      ]
    );
    const contactId = result.rows[0].id;
    return this._linkAndFetch(client, contactId, accountId);
  }

  // Link an (existing or just-created) contact to an account when one is given,
  // then return the contact with its linked accounts.
  async _linkAndFetch(client, contactId, accountId) {
    if (accountId) {
      await client.query(
        'INSERT INTO account_contacts (account_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [accountId, contactId]
      );
    }
    return this._fetchWithAccounts(client, contactId);
  }

  // Idempotent create — the contacts analogue of vendor_products.findOrCreate.
  // Lets the agent send what it has and let the server decide whether the person
  // already exists, so near-duplicate contacts (especially kind=internal
  // teammates) stop piling up. Match precedence:
  //   1. exact email (case-insensitive) — strongest signal
  //   2. exact full_name + kind
  //   3. fuzzy full_name within the same kind (pg_trgm >= CONTACT_FUZZY_THRESHOLD)
  //      — absorbs typos / spacing / punctuation variants. A *different* email on
  //      the candidate vetoes the fuzzy merge (a distinct address ⇒ distinct human).
  // A match is (re)linked to accountId when provided. Never throws 409 (that's
  // the difference from create). Returns { contact, created, matched_by?, match_score? }.
  async findOrCreate(userId, data, accountId) {
    return withUser(userId, async (client) => {
      const kind = normalizeKind(data.kind) || 'account';
      const fullName = (data.full_name || '').trim();
      if (!fullName) {
        throw badRequest('findOrCreate requires a non-empty full_name.');
      }
      const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';

      // 1) exact email match
      if (email) {
        const row = (await client.query(
          'SELECT id FROM contacts WHERE LOWER(email) = $1 ORDER BY id LIMIT 1',
          [email]
        )).rows[0];
        if (row) {
          const contact = await this._linkAndFetch(client, row.id, accountId);
          return { contact, created: false, matched_by: 'email' };
        }
      }

      // 2) exact full_name + kind match
      const exact = (await client.query(
        'SELECT id FROM contacts WHERE full_name = $1 AND kind = $2 ORDER BY id LIMIT 1',
        [fullName, kind]
      )).rows[0];
      if (exact) {
        const contact = await this._linkAndFetch(client, exact.id, accountId);
        return { contact, created: false, matched_by: 'full_name' };
      }

      // 3) fuzzy full_name within the same kind. The `%` prefilter is served by
      //    idx_contacts_full_name_trgm; we then enforce the stricter app-level
      //    threshold (and the email-conflict veto) in JS.
      const cand = (await client.query(
        `SELECT id, email, similarity(lower(full_name), lower($1)) AS sim
           FROM contacts
          WHERE kind = $2 AND lower(full_name) % lower($1)
          ORDER BY sim DESC NULLS LAST
          LIMIT 1`,
        [fullName, kind]
      )).rows[0];
      if (cand && Number(cand.sim) >= CONTACT_FUZZY_THRESHOLD) {
        const candEmail = (cand.email || '').trim().toLowerCase();
        const emailsConflict = email && candEmail && email !== candEmail;
        if (!emailsConflict) {
          const contact = await this._linkAndFetch(client, cand.id, accountId);
          return { contact, created: false, matched_by: 'fuzzy', match_score: Number(cand.sim) };
        }
      }

      // 4) no match → create
      const contact = await this._insert(client, { ...data, full_name: fullName }, kind, accountId);
      return { contact, created: true };
    });
  }

  async linkAccount(userId, contactId, accountId) {
    return withUser(userId, async (client) => {
      await client.query(
        'INSERT INTO account_contacts (account_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [accountId, contactId]
      );
      return this._fetchWithAccounts(client, contactId);
    });
  }

  async unlinkAccount(userId, contactId, accountId) {
    return withUser(userId, async (client) => {
      await client.query(
        'DELETE FROM account_contacts WHERE account_id = $1 AND contact_id = $2',
        [accountId, contactId]
      );
      return this._fetchWithAccounts(client, contactId);
    });
  }

  async update(userId, id, data) {
    return withUser(userId, async (client) => {
      const existing = (await client.query('SELECT id, kind FROM contacts WHERE id = $1', [id])).rows[0];
      if (!existing) return null;

      const kind = data.kind !== undefined ? (normalizeKind(data.kind) || existing.kind) : existing.kind;

      await client.query(
        `UPDATE contacts SET
           full_name = $2, company = $3, title = $4,
           email = $5, phone = $6, linkedin = $7, notes = $8, kind = $9,
           location_raw = $10, city = $11, state = $12, country = $13
         WHERE id = $1`,
        [
          id,
          data.full_name,
          data.company || null,
          data.title || null,
          data.email || null,
          data.phone || null,
          data.linkedin || null,
          data.notes || null,
          kind,
          data.location_raw || null,
          data.city || null,
          data.state || null,
          data.country || null,
        ]
      );
      return this._fetchWithAccounts(client, id);
    });
  }

  async patch(userId, id, data) {
    return withUser(userId, async (client) => {
      const existing = (await client.query(`SELECT ${CONTACT_COLS} FROM contacts WHERE id = $1`, [id])).rows[0];
      if (!existing) return null;

      const updated = { ...existing };
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined && key !== 'id' && key !== 'created_at' && key !== 'accounts' && key !== 'user_id') {
          updated[key] = value;
        }
      }
      if (data.kind !== undefined) updated.kind = normalizeKind(data.kind);

      await client.query(
        `UPDATE contacts SET
           full_name = $2, company = $3, title = $4,
           email = $5, phone = $6, linkedin = $7, notes = $8, kind = $9,
           location_raw = $10, city = $11, state = $12, country = $13
         WHERE id = $1`,
        [
          id,
          updated.full_name,
          updated.company,
          updated.title,
          updated.email,
          updated.phone,
          updated.linkedin,
          updated.notes,
          updated.kind,
          updated.location_raw,
          updated.city,
          updated.state,
          updated.country,
        ]
      );
      return this._fetchWithAccounts(client, id);
    });
  }

  async delete(userId, id) {
    return withUser(userId, async (client) => {
      const existing = (await client.query(`SELECT ${CONTACT_COLS} FROM contacts WHERE id = $1`, [id])).rows[0];
      if (!existing) return null;
      await client.query('DELETE FROM contacts WHERE id = $1', [id]);
      return existing;
    });
  }
}
