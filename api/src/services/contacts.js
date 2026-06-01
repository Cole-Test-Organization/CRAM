import { withUser } from '../db/connection.js';
import { badRequest, conflict, notFound } from '../lib/http-error.js';
import { fillBlanks } from './_enrich.js';
import { normalizeDomain, suggestAccountName } from './_domain.js';
import { parseEmailList } from './_email.js';
import { slugify } from './_slug.js';

const CONTACT_COLS = 'id, full_name, company, title, email, phone, linkedin, notes, kind, location_raw, city, state, country, created_at, updated_at';
const VALID_KINDS = new Set(['account', 'partner', 'internal']);

// Columns findOrCreate fills on a matched contact when they're blank and we now
// have a value (fill-only enrich — never overwrites curated data). Deliberately
// excludes `kind` (a classification, never blank) and the DB-managed
// id/timestamps/user_id.
const CONTACT_ENRICHABLE_COLS = ['full_name', 'company', 'title', 'email', 'phone', 'linkedin', 'notes', 'location_raw', 'city', 'state', 'country'];

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
  // accountsService / internalDomainsService / contactEnrichmentService are
  // wired onto the instance AFTER construction by the service bags
  // (mcp/server.js, agent/mcp-client.js): ContactEnrichmentService itself
  // depends on ContactsService, so taking these as constructor args would
  // create a construction-order cycle. They power the from-emails staging
  // methods (resolveEmails, importFromEmails); plain CRUD doesn't need them.
  constructor({ accountsService = null, internalDomainsService = null, contactEnrichmentService = null } = {}) {
    this.accountsService = accountsService;
    this.internalDomainsService = internalDomainsService;
    this.contactEnrichmentService = contactEnrichmentService;
  }

  async getAll(userId, { company, search, kind, city, country, limit, offset = 0 } = {}) {
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
      // No default cap: list everything matching unless the caller explicitly
      // asks for a page. (limit omitted ⇒ all rows; offset alone still works.)
      let paginationSql = '';
      if (limit != null) {
        params.push(limit, offset);
        paginationSql = `LIMIT $${params.length - 1} OFFSET $${params.length}`;
      } else if (offset) {
        params.push(offset);
        paginationSql = `OFFSET $${params.length}`;
      }
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
        ${paginationSql}
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
    return withUser(userId, async (client) => {
      const contact = await this._fetchWithAccounts(client, id);
      if (!contact) return null;
      // Attach the contact's meeting history (with their per-meeting RSVP) for
      // the contact-detail view. Only on getById — the explicit detail fetch —
      // so the high-traffic write/resolve paths (findOrCreate, link, enrich)
      // that route through _fetchWithAccounts don't pay for this extra query.
      contact.meetings = await this._fetchMeetings(client, id);
      return contact;
    });
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

  // Slim email lookup for staging flows (resolve_emails): identity-only, just
  // enough to label an attendee in the from-emails picker. Skips the full
  // record + linked-accounts fan-out that getByEmail/_fetchWithAccounts pull,
  // so a many-attendee resolve doesn't serialize a fat contact per row.
  // Returns null when no contact owns the email.
  async getByEmailBrief(userId, email) {
    if (!email || typeof email !== 'string') return null;
    const normalized = email.trim().toLowerCase();
    if (!normalized) return null;
    return withUser(userId, async (client) => {
      const row = (await client.query(
        `SELECT id, full_name, email, title, company, kind FROM contacts WHERE LOWER(email) = $1 ORDER BY id LIMIT 1`,
        [normalized]
      )).rows[0];
      return row || null;
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

  // The meetings this contact attended (was linked to), newest first, each
  // carrying the contact's per-meeting RSVP/attendance `status` from the
  // meeting_attendees join row (going/declined/maybe/invited/owner, or null when
  // unknown — e.g. notes-import or legacy events). Powers the contact-detail
  // "meeting history" view. Internal-only notes (account_id NULL) come back with
  // null account fields; RLS scopes this to the current user's meetings.
  async _fetchMeetings(client, contactId) {
    return (await client.query(`
      SELECT m.id, m.date, m.title, m.internal, m.needs_review,
             m.account_id, a.slug AS account_slug, a.name AS account_name,
             ma.status
      FROM meeting_attendees ma
      JOIN meetings m ON m.id = ma.meeting_id
      LEFT JOIN accounts a ON a.id = m.account_id
      WHERE ma.contact_id = $1
      ORDER BY m.date DESC, m.id DESC
    `, [contactId])).rows;
  }

  // Resolve the (kind, full_name, email) identity from raw input. The one hard
  // rule for creating a contact: it needs at least one identifying handle — an
  // email OR a name. Everything else is optional and enrichable. Returns
  // full_name trimmed and email trimmed+lowercased; empty values collapse to ''.
  _identity(data) {
    const kind = normalizeKind(data?.kind) || 'account';
    const fullName = typeof data?.full_name === 'string' ? data.full_name.trim() : '';
    const email = typeof data?.email === 'string' ? data.email.trim().toLowerCase() : '';
    if (!fullName && !email) {
      throw badRequest('A contact needs at least an email or a full_name — both were empty. Pass data.email (e.g. "jsmith@acme.com") or data.full_name.');
    }
    return { kind, fullName, email };
  }

  // Single dedupe core shared by create() and findOrCreate() so every creation
  // path runs identical checks. Precedence:
  //   1. exact email (case-insensitive) — strongest signal
  //   2. exact full_name + kind
  //   3. fuzzy full_name within the same kind (pg_trgm >= CONTACT_FUZZY_THRESHOLD),
  //      vetoed when the candidate carries a *different* email (distinct address
  //      ⇒ distinct human)
  // Name tiers are skipped for email-only input (no name to match on). No
  // writes — returns { id, matched_by, match_score? } or null and lets the
  // caller decide whether to enrich, (re)link, or 409.
  async _matchExisting(client, { email, fullName, kind }) {
    if (email) {
      const row = (await client.query(
        'SELECT id FROM contacts WHERE LOWER(email) = $1 ORDER BY id LIMIT 1',
        [email]
      )).rows[0];
      if (row) return { id: row.id, matched_by: 'email' };
    }
    if (fullName) {
      const exact = (await client.query(
        'SELECT id FROM contacts WHERE full_name = $1 AND kind = $2 ORDER BY id LIMIT 1',
        [fullName, kind]
      )).rows[0];
      if (exact) return { id: exact.id, matched_by: 'full_name' };

      // The `%` prefilter is served by idx_contacts_full_name_trgm; we then
      // enforce the stricter app-level threshold (and email-conflict veto) in JS.
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
        if (!emailsConflict) return { id: cand.id, matched_by: 'fuzzy', match_score: Number(cand.sim) };
      }
    }
    return null;
  }

  // Explicit create. Runs the same dedupe core as findOrCreate but *refuses*
  // (409, with the existing row attached) on a match instead of upserting —
  // and never writes on that path (no enrich). Prefer findOrCreate for
  // ingestion; this is for callers that genuinely expect a brand-new contact.
  async create(userId, data, accountId) {
    return withUser(userId, async (client) => {
      const { kind, fullName, email } = this._identity(data);
      const match = await this._matchExisting(client, { email, fullName, kind });
      if (match) {
        const existing = await this._fetchWithAccounts(client, match.id);
        throw Object.assign(
          conflict(`Contact already exists (matched on ${match.matched_by}): id=${match.id}, name="${existing?.full_name ?? ''}"${existing?.email ? `, email="${existing.email}"` : ''}. Update it via PATCH /api/contacts/${match.id} (contacts tool action="update"), link it via POST /api/contacts/${match.id}/accounts/:accountId (action="link_account"), or use find_or_create to upsert idempotently.`),
          { existing }
        );
      }
      return this._insert(client, { ...data, full_name: fullName || null }, kind, accountId);
    });
  }

  // The one and only `INSERT INTO contacts` in the codebase — every creation
  // path (create, findOrCreate, the bulk importer) routes through here so no
  // bespoke INSERT can skip a column default or a future constraint. Assumes
  // the caller has validated/normalized `kind` and decided no dedupe match
  // applies. full_name may be null (email-only contact). Returns the new id.
  async _insertRow(client, data, kind) {
    const result = await client.query(
      `INSERT INTO contacts (user_id, full_name, company, title, email, phone, linkedin, notes, kind,
                             location_raw, city, state, country)
       VALUES (current_setting('app.current_user_id')::bigint, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        data.full_name ?? null,
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
    return result.rows[0].id;
  }

  // Insert + (optional) account link + fetch with accounts. The full-object
  // variant used by create()/findOrCreate(); the importer uses _insertRow
  // directly to skip the per-row fetch.
  async _insert(client, data, kind, accountId) {
    const contactId = await this._insertRow(client, data, kind);
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

  // Fill-only enrich on a matched contact: copy any value we now have into a
  // column that's currently blank (null / empty), never overwriting a non-blank
  // stored value. Idempotent — re-running with the same data writes nothing, so
  // the updated_at trigger stays quiet on a pure re-link. Returns the list of
  // columns filled (empty ⇒ no UPDATE issued).
  async _enrichBlanks(client, id, data) {
    const existing = (await client.query(
      `SELECT ${CONTACT_ENRICHABLE_COLS.join(', ')} FROM contacts WHERE id = $1`,
      [id]
    )).rows[0];
    if (!existing) return [];
    const { patch, fields } = fillBlanks(existing, data, CONTACT_ENRICHABLE_COLS);
    if (!fields.length) return [];
    const cols = Object.keys(patch);
    const setSql = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
    await client.query(
      `UPDATE contacts SET ${setSql} WHERE id = $1`,
      [id, ...cols.map((c) => patch[c])]
    );
    return fields;
  }

  // Idempotent upsert — the single creation path every caller should funnel
  // through (calendar/notes import, the from-emails meeting flow, the agent),
  // so the same dedupe + enrich checks always run and near-duplicate contacts
  // (especially kind=internal teammates) stop piling up. Match precedence lives
  // in _matchExisting (email → exact name+kind → fuzzy name). On a match we
  //   (a) fill any blank column we now have a value for (fill-only enrich —
  //       never overwriting curated data), and
  //   (b) (re)link to accountId when given.
  // On no match we insert — full_name may be null (an email-only contact is
  // valid; we no longer fabricate a name from the address). Never throws 409
  // (that's create()'s job). Returns
  //   { contact, created, matched_by?, match_score?, enriched?, enriched_fields? }.
  async findOrCreate(userId, data, accountId) {
    return withUser(userId, async (client) => {
      const { kind, fullName, email } = this._identity(data);
      const match = await this._matchExisting(client, { email, fullName, kind });
      if (match) {
        const enriched_fields = await this._enrichBlanks(
          client, match.id, { ...data, full_name: fullName || null, email: email || null }
        );
        const contact = await this._linkAndFetch(client, match.id, accountId);
        return {
          contact,
          created: false,
          matched_by: match.matched_by,
          ...(match.match_score != null ? { match_score: match.match_score } : {}),
          ...(enriched_fields.length ? { enriched: true, enriched_fields } : {}),
        };
      }
      const contact = await this._insert(client, { ...data, full_name: fullName || null }, kind, accountId);
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

  // ── From-emails staging (account + people; no meeting) ──────────────────
  // These two used to live on MeetingsService, which forced every "add these
  // people" request through a meeting. They belong here: resolving an email
  // list and materializing the account + contacts is a contacts/accounts
  // concern. MeetingsService.createFromEmails now layers a meeting on top of
  // importFromEmails when (and only when) there are actual notes.

  // Resolve a list of email strings (raw or RFC-5322) into what we already know
  // about each one — matched contacts + account candidates grouped by domain —
  // so the caller can stage an import (account + contacts) or a from-emails
  // meeting. Pure read, no writes. Lookups are deliberately SLIM (identity-only
  // contact + account rows, no linked-record fan-out): this is a staging probe,
  // and embedding full account subtrees here — then duplicating them per
  // attendee via account_match — used to blow out agent context windows on
  // large accounts. Output:
  //   { attendees: [{ email, domain, name_guess, kind, contact, account_match }],
  //     accounts:  [{ domain, account, attendee_count, suggested_name }],
  //     primary_domain }
  async resolveEmails(userId, emails) {
    if (!this.accountsService) {
      throw new Error('ContactsService.resolveEmails requires accountsService (wire it onto the instance in the service bag)');
    }
    const parsed = Array.isArray(emails)
      ? parseEmailList(emails.join('\n'))
      : parseEmailList(emails);
    const internalDomains = this.internalDomainsService
      ? await this.internalDomainsService.getDomainSet(userId)
      : new Set();

    const attendees = [];
    const domainAttendeeCount = new Map();
    for (const p of parsed) {
      const isInternal = !!(p.domain && internalDomains.has(p.domain));
      const contact = await this.getByEmailBrief(userId, p.email);
      attendees.push({
        email: p.email,
        domain: p.domain,
        name_guess: p.name_guess,
        kind: isInternal ? 'internal' : 'account',
        contact: contact || null,
      });
      if (!isInternal && p.domain) {
        domainAttendeeCount.set(p.domain, (domainAttendeeCount.get(p.domain) || 0) + 1);
      }
    }

    const accounts = [];
    for (const [domain, count] of domainAttendeeCount.entries()) {
      const account = await this.accountsService.getByDomainBrief(userId, domain);
      accounts.push({
        domain,
        account: account || null,
        attendee_count: count,
        suggested_name: account ? account.name : suggestAccountName(domain),
      });
    }
    accounts.sort((a, b) => b.attendee_count - a.attendee_count || a.domain.localeCompare(b.domain));
    const primary = accounts[0]?.domain || null;

    // Attach the matched (slim) account to each external attendee so the caller
    // doesn't have to cross-reference. Identity-only objects, so the
    // per-attendee duplication is cheap.
    for (const a of attendees) {
      if (a.kind !== 'account' || !a.domain) { a.account_match = null; continue; }
      const candidate = accounts.find(c => c.domain === a.domain);
      a.account_match = candidate?.account || null;
    }
    return { attendees, accounts, primary_domain: primary };
  }

  // Materialize an account + its contacts from a resolved email list — WITHOUT
  // creating a meeting. The account-and-people half of the from-emails flow;
  // MeetingsService.createFromEmails layers a meeting on top of this. The caller
  // is expected to have run resolveEmails first and filled in its decisions.
  //
  // Payload:
  //   {
  //     account: { mode: 'existing'|'new', account_id?, name?, domain? },
  //     contacts: [
  //       { mode: 'existing', contact_id, link_to_account? } |
  //       { mode: 'new', full_name, email?, kind?, research? }
  //     ]
  //   }
  // Returns { account_id, contact_ids, enrichment_jobs }.
  async importFromEmails(userId, payload) {
    if (!this.accountsService) {
      throw new Error('ContactsService.importFromEmails requires accountsService (wire it onto the instance in the service bag)');
    }
    if (!payload?.account?.mode) {
      throw badRequest('payload.account.mode is required: "existing" (also pass account_id of a matched account) or "new" (also pass name and optional domain — a fresh account row will be created).');
    }

    // 1) Resolve/create the account.
    let accountId;
    if (payload.account.mode === 'existing') {
      if (!payload.account.account_id) {
        throw badRequest('payload.account.account_id is required when account.mode="existing". Use resolve_emails to get the matched account candidate id, or look up the account via the accounts tool.');
      }
      const acct = await this.accountsService.getById(userId, payload.account.account_id);
      if (!acct) throw notFound(`Account not found: id=${payload.account.account_id}. Use the accounts tool (list/search/get) to find the right id, or switch to account.mode="new" with a name.`);
      accountId = acct.id;
      // If the user typed a domain that isn't yet on the account, append it.
      if (payload.account.domain) {
        const domain = normalizeDomain(payload.account.domain);
        const existingDomains = Array.isArray(acct.domains) ? acct.domains : [];
        if (domain && !existingDomains.includes(domain)) {
          await this.accountsService.patch(userId, acct.id, { domains: [...existingDomains, domain] });
        }
      }
    } else if (payload.account.mode === 'new') {
      if (!payload.account.name) {
        throw badRequest('payload.account.name is required when account.mode="new" (the company display name — the slug is derived automatically). Optional: payload.account.domain to populate the domains array.');
      }
      const slug = slugify(payload.account.name);
      const domain = normalizeDomain(payload.account.domain || '');
      const created = await this.accountsService.create(userId, {
        name: payload.account.name,
        slug,
        domains: domain ? [domain] : [],
      });
      accountId = created.id;
    } else {
      throw badRequest(`Unknown account.mode: "${payload.account.mode}". Must be "existing" (also pass account_id) or "new" (also pass name).`);
    }

    // 2) Resolve/create contacts.
    const contactIds = [];
    const enrichTargets = [];
    for (const c of payload.contacts || []) {
      if (c.mode === 'existing') {
        if (!c.contact_id) {
          throw badRequest('contact.contact_id is required when contact.mode="existing". Use the contact ids returned by resolve_emails (or look them up via the contacts tool).');
        }
        contactIds.push(c.contact_id);
        if (c.link_to_account) {
          try { await this.linkAccount(userId, c.contact_id, accountId); }
          catch { /* idempotent — ignore conflict */ }
        }
      } else if (c.mode === 'new') {
        if (!c.full_name) {
          throw badRequest('contact.full_name is required when contact.mode="new" (the person\'s display name). Optional: contact.email, contact.kind ("account" default | "partner" | "internal"), contact.research (true to enqueue background enrichment).');
        }
        const kind = c.kind || 'account';
        const linkAccountId = kind === 'internal' ? null : accountId;
        // findOrCreate, not create: a "new" attendee that turns out to already
        // exist should link/enrich idempotently, not 409 the whole write.
        const { contact } = await this.findOrCreate(userId, {
          full_name: c.full_name,
          email: c.email || null,
          kind,
        }, linkAccountId);
        contactIds.push(contact.id);
        if (c.research) enrichTargets.push({ contactId: contact.id, name: contact.full_name });
      } else {
        throw badRequest(`Unknown contact.mode: "${c.mode}". Must be "existing" (also pass contact_id) or "new" (also pass full_name).`);
      }
    }

    // 3) Fire-and-forget enrichment for new contacts the user opted in for.
    //    Pulls account name from the just-created/-resolved account so the
    //    outreach lookup has the right disambiguator.
    const enrichmentJobs = [];
    if (enrichTargets.length > 0 && this.contactEnrichmentService) {
      const acct = await this.accountsService.getById(userId, accountId);
      const accountName = acct?.name || null;
      for (const t of enrichTargets) {
        const jobId = this.contactEnrichmentService.enqueue(userId, {
          contactId: t.contactId,
          name: t.name,
          accountName,
        });
        enrichmentJobs.push({ contact_id: t.contactId, enrichment_job_id: jobId });
      }
    }

    return { account_id: accountId, contact_ids: contactIds, enrichment_jobs: enrichmentJobs };
  }
}
