import { withUser } from '../db/connection.js';
import { deriveFilename, slugify } from './_slug.js';
import { jsonb } from './_json.js';
import { badRequest } from '../lib/http-error.js';

export const BUNDLE_FORMAT = 'se-os/account-bundle';
export const BUNDLE_VERSION = 1;

const VENDOR_ARRAY_COLS = [
  'firewall_ids', 'edr_ids', 'siem_ids', 'idp_ids', 'mfa_ids', 'pam_ids',
  'email_security_ids', 'mdr_ids', 'msp_ids', 'sase_ids', 'sdwan_ids',
  'vpn_ids', 'dlp_ids', 'casb_ids', 'vuln_mgmt_ids', 'ticketing_ids',
  'productivity_suite_ids', 'cloud_provider_ids',
  'cspm_ids', 'appsec_ids', 'ndr_ids', 'iot_ot_ids',
];

const DETAILS_SCALAR_COLS = [
  'industry', 'revenue_usd', 'employee_count', 'user_count',
  'endpoint_count', 'server_count', 'site_count', 'dc_count',
  'hq_city', 'hq_state', 'hq_country',
  'it_team_size', 'security_team_size',
  'soc_model', 'has_ot_environment', 'has_iot_environment',
  'technical_notes', 'last_verified_at',
];

const CONTACT_PORTABLE_COLS = [
  'full_name', 'company', 'title', 'email', 'phone', 'linkedin', 'notes',
  'kind', 'location_raw', 'city', 'state', 'country',
];

export class ImportExportService {
  constructor({ contactsService, accountsService } = {}) {
    // Optional. When wired in (server.js / agent/mcp-client.js), the importer
    // delegates duplicate detection to the per-service `_findExisting` helpers
    // so contacts/accounts have one source of truth for "what counts as a
    // match." Falls back to inline SQL if a service isn't provided.
    this.contactsService = contactsService;
    this.accountsService = accountsService;
  }

  // ── EXPORT ────────────────────────────────────────────────────────────

  async exportAccounts(userId, slugs) {
    if (!Array.isArray(slugs) || slugs.length === 0) {
      throw badRequest('slugs must be a non-empty array of account slugs. Discover slugs via the accounts tool (action="list"). Each slug must already exist as an account in this tenant.');
    }
    return withUser(userId, async (client) => {
      const accounts = [];
      const missing = [];
      for (const slug of slugs) {
        const acct = await this._exportSingleAccount(client, slug);
        if (acct) accounts.push(acct);
        else missing.push(slug);
      }
      return {
        format: BUNDLE_FORMAT,
        version: BUNDLE_VERSION,
        exported_at: new Date().toISOString(),
        accounts,
        missing_slugs: missing,
      };
    });
  }

  async _exportSingleAccount(client, slug) {
    const acct = (await client.query(
      `SELECT id, slug, name, status, last_contact, relationship_summary,
              open_threads, active_deals, domains
       FROM accounts WHERE slug = $1`,
      [slug]
    )).rows[0];
    if (!acct) return null;

    const details = await this._exportDetails(client, acct.id);
    const contacts = await this._exportContactsForAccount(client, acct.id);
    const meetings = await this._exportMeetings(client, acct.id);
    const opportunities = await this._exportOpportunities(client, acct.id);
    const partners = await this._exportPartnerShells(client, acct.id);

    return {
      slug: acct.slug,
      name: acct.name,
      status: acct.status,
      last_contact: acct.last_contact,
      relationship_summary: acct.relationship_summary,
      open_threads: acct.open_threads,
      active_deals: acct.active_deals,
      domains: acct.domains,
      details,
      contacts,
      meetings,
      opportunities,
      partners,
    };
  }

  async _exportDetails(client, accountId) {
    const row = (await client.query(
      'SELECT * FROM account_details WHERE account_id = $1',
      [accountId]
    )).rows[0];
    if (!row) return null;

    const out = {};
    for (const col of DETAILS_SCALAR_COLS) out[col] = row[col];
    out.compliance_frameworks = row.compliance_frameworks || [];

    // Collect all referenced vendor_product ids and resolve to portable refs.
    const allIds = new Set();
    for (const col of VENDOR_ARRAY_COLS) {
      for (const id of row[col] || []) allIds.add(Number(id));
    }
    const refsById = new Map();
    if (allIds.size > 0) {
      const refs = (await client.query(
        `SELECT vp.id, vp.name AS product_name, vp.slug AS product_slug, vp.category,
                v.name AS vendor_name, v.slug AS vendor_slug
         FROM vendor_products vp JOIN vendors v ON v.id = vp.vendor_id
         WHERE vp.id = ANY($1::bigint[])`,
        [[...allIds]]
      )).rows;
      for (const r of refs) refsById.set(Number(r.id), r);
    }

    out.vendor_products = {};
    for (const col of VENDOR_ARRAY_COLS) {
      out.vendor_products[col] = (row[col] || [])
        .map((id) => refsById.get(Number(id)))
        .filter(Boolean)
        .map((r) => ({
          vendor_slug: r.vendor_slug,
          vendor_name: r.vendor_name,
          product_slug: r.product_slug,
          product_name: r.product_name,
          category: r.category,
        }));
    }
    return out;
  }

  async _exportContactsForAccount(client, accountId) {
    const rows = (await client.query(
      `SELECT c.full_name, c.company, c.title, c.email, c.phone, c.linkedin,
              c.notes, c.kind, c.location_raw, c.city, c.state, c.country
       FROM contacts c
       JOIN account_contacts ac ON ac.contact_id = c.id
       WHERE ac.account_id = $1
       ORDER BY c.full_name`,
      [accountId]
    )).rows;
    return rows;
  }

  async _exportMeetings(client, accountId) {
    const meetings = (await client.query(
      `SELECT id, date, title, filename, body, internal
       FROM meetings
       WHERE account_id = $1
       ORDER BY date DESC`,
      [accountId]
    )).rows;
    for (const m of meetings) {
      // Only carry attendees who are actually contacts ON THIS account
      // (account_contacts). Attendees who merely sat in a meeting but were never
      // linked to the account — teammates, partner reps — are deliberately left
      // out so importing the bundle into another tenant doesn't spawn a pile of
      // unrelated "filler" contacts. The importer mirrors this and also drops
      // any unlinked ref. Unlinked attendees (names with no contact) are a local
      // triage concept and aren't carried in the portable bundle.
      const attendees = (await client.query(
        `SELECT c.full_name, c.company, c.title, c.email, c.phone, c.linkedin,
                c.notes, c.kind, c.location_raw, c.city, c.state, c.country
         FROM meeting_attendees ma
         JOIN contacts c ON c.id = ma.contact_id
         JOIN account_contacts ac ON ac.contact_id = c.id AND ac.account_id = $2
         WHERE ma.meeting_id = $1`,
        [m.id, accountId]
      )).rows;
      m.attendee_refs = attendees;
      delete m.id;
    }
    return meetings;
  }

  async _exportOpportunities(client, accountId) {
    const opps = (await client.query(
      `SELECT id, name, opp_link, trr_link, tech_validation_link, stage, notes,
              why_change, why_now, why_us
       FROM opportunities WHERE account_id = $1
       ORDER BY created_at DESC`,
      [accountId]
    )).rows;
    for (const o of opps) {
      const products = (await client.query(
        `SELECT p.name, pc.name AS category_name
         FROM opp_products op
         JOIN products p ON p.id = op.product_id
         LEFT JOIN product_categories pc ON pc.id = p.category_id
         WHERE op.opportunity_id = $1`,
        [o.id]
      )).rows;
      o.products = products;
      delete o.id;
    }
    return opps;
  }

  async _exportPartnerShells(client, accountId) {
    const partners = (await client.query(
      `SELECT a.id, a.slug, a.name, a.status
       FROM account_partners ap JOIN accounts a ON a.id = ap.partner_account_id
       WHERE ap.customer_account_id = $1
       ORDER BY a.name`,
      [accountId]
    )).rows;
    for (const p of partners) {
      const contacts = (await client.query(
        `SELECT c.full_name, c.company, c.title, c.email, c.phone, c.linkedin,
                c.notes, c.kind, c.location_raw, c.city, c.state, c.country
         FROM contacts c JOIN account_contacts ac ON ac.contact_id = c.id
         WHERE ac.account_id = $1 AND c.kind = 'partner'
         ORDER BY c.full_name`,
        [p.id]
      )).rows;
      p.contacts = contacts;
      delete p.id;
    }
    return partners;
  }

  // ── IMPORT ────────────────────────────────────────────────────────────

  async importBundle(userId, bundle) {
    if (!bundle || typeof bundle !== 'object') {
      throw badRequest('bundle must be an object — the JSON produced by action="export" on the source tenant. Shape: { format: "se-os/account-bundle", version: 1, accounts: [...] }.');
    }
    if (bundle.format !== BUNDLE_FORMAT) {
      throw badRequest(`Unsupported bundle format: ${bundle.format}. Expected: ${BUNDLE_FORMAT}`);
    }
    if (bundle.version !== BUNDLE_VERSION) {
      throw badRequest(`Unsupported bundle version: ${bundle.version}. Expected: ${BUNDLE_VERSION}`);
    }
    if (!Array.isArray(bundle.accounts)) {
      throw badRequest('bundle.accounts must be an array. A valid bundle from action="export" always carries an accounts[] (possibly empty). If you are constructing this by hand, that is the array of account objects to import.');
    }

    const results = [];
    for (const acct of bundle.accounts) {
      const result = await this._importOneAccount(userId, acct);
      results.push(result);
    }

    return {
      imported_at: new Date().toISOString(),
      account_count: results.length,
      results,
    };
  }

  async _importOneAccount(userId, acctJson) {
    const slug = acctJson?.slug;
    if (!slug) {
      return { slug: null, ok: false, error: 'account missing slug' };
    }
    try {
      return await withUser(userId, async (client) => {
        const tally = { accounts: 0, contacts: 0, meetings: 0, opportunities: 0, partners: 0, products: 0 };
        const updated = { account: false, details: false, contacts: 0, meetings: 0, opportunities: 0 };

        const accountInfo = await this._upsertAccount(client, acctJson, tally, updated);
        const accountId = accountInfo.id;

        if (acctJson.details) {
          await this._upsertDetails(client, accountId, acctJson.details);
          updated.details = true;
        }

        const partnerInfos = await this._upsertPartners(client, accountId, acctJson.partners || [], tally);

        await this._upsertContacts(
          client, accountId, acctJson.contacts || [], tally, updated
        );

        // Resolve meeting attendees ONLY against this account's own contacts, so
        // an attendee who isn't a profile contact is dropped rather than
        // recreated as an unrelated standalone contact in the destination.
        const accountContactLookup = await this._buildAccountContactLookup(client, accountId);

        await this._upsertMeetings(
          client, accountId, acctJson.meetings || [], accountContactLookup, tally, updated
        );

        await this._upsertOpportunities(
          client, accountId, acctJson.opportunities || [], tally, updated
        );

        return { slug, ok: true, account_id: accountId, created: tally, updated };
      });
    } catch (err) {
      return { slug, ok: false, error: err.message };
    }
  }

  async _upsertAccount(client, j, tally, updated) {
    const existing = this.accountsService
      ? await this.accountsService._findExisting(client, { slug: j.slug, domains: j.domains, name: j.name })
      : (await client.query('SELECT id FROM accounts WHERE slug = $1', [j.slug])).rows[0];

    if (!existing) {
      const ins = await client.query(
        `INSERT INTO accounts (
           user_id, slug, name, status, last_contact, relationship_summary,
           open_threads, active_deals, domains
         ) VALUES (
           current_setting('app.current_user_id')::bigint,
           $1, $2, $3, $4, $5, $6, $7, coalesce($8, '[]'::jsonb)
         ) RETURNING id`,
        [
          j.slug,
          j.name || j.slug,
          j.status || 'account',
          j.last_contact || null,
          j.relationship_summary || null,
          jsonb(j.open_threads),
          j.active_deals || null,
          jsonb(j.domains),
        ]
      );
      tally.accounts++;
      return { id: ins.rows[0].id, created: true };
    }

    // PATCH-merge: only overwrite a field if the import has a non-null value for it.
    const fields = [];
    const params = [existing.id];
    const set = (col, val) => {
      params.push(val);
      fields.push(`${col} = $${params.length}`);
    };
    if (j.name != null) set('name', j.name);
    if (j.status != null) set('status', j.status);
    if (j.last_contact != null) set('last_contact', j.last_contact);
    if (j.relationship_summary != null) set('relationship_summary', j.relationship_summary);
    if (j.active_deals != null) set('active_deals', j.active_deals);
    if (j.open_threads != null) set('open_threads', jsonb(j.open_threads));
    if (Array.isArray(j.domains)) set('domains', jsonb(j.domains));

    if (fields.length > 0) {
      await client.query(`UPDATE accounts SET ${fields.join(', ')} WHERE id = $1`, params);
      updated.account = true;
    }
    return { id: existing.id, created: false };
  }

  async _upsertDetails(client, accountId, d) {
    const touched = {};
    for (const col of DETAILS_SCALAR_COLS) {
      if (d[col] !== undefined) touched[col] = d[col];
    }
    if (Array.isArray(d.compliance_frameworks)) {
      touched.compliance_frameworks = d.compliance_frameworks;
    }

    // Resolve vendor_product refs to local IDs (creating vendors / vendor_products as needed).
    if (d.vendor_products && typeof d.vendor_products === 'object') {
      for (const col of VENDOR_ARRAY_COLS) {
        const refs = d.vendor_products[col];
        if (!Array.isArray(refs)) continue;
        const ids = [];
        for (const ref of refs) {
          const id = await this._resolveVendorProduct(client, ref, col);
          if (id) ids.push(id);
        }
        touched[col] = ids;
      }
    }

    const exists = (await client.query(
      'SELECT account_id FROM account_details WHERE account_id = $1',
      [accountId]
    )).rows[0];

    if (!exists) {
      const cols = ['account_id', ...Object.keys(touched)];
      const vals = [accountId, ...Object.values(touched)];
      const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
      await client.query(
        `INSERT INTO account_details (${cols.join(', ')}) VALUES (${placeholders})`,
        vals
      );
    } else if (Object.keys(touched).length > 0) {
      const setClauses = [];
      const params = [accountId];
      for (const [col, val] of Object.entries(touched)) {
        params.push(val);
        setClauses.push(`${col} = $${params.length}`);
      }
      await client.query(
        `UPDATE account_details SET ${setClauses.join(', ')} WHERE account_id = $1`,
        params
      );
    }
  }

  // Match (or create) a vendor_product from a portable ref.
  // ref shape: { vendor_slug, vendor_name, product_slug, product_name, category }
  async _resolveVendorProduct(client, ref, sourceCol) {
    if (!ref) return null;
    const vendorSlug = ref.vendor_slug || (ref.vendor_name ? slugify(ref.vendor_name) : null);
    const vendorName = ref.vendor_name || ref.vendor_slug;
    const productSlug = ref.product_slug || (ref.product_name ? slugify(ref.product_name) : null);
    const productName = ref.product_name || ref.product_slug;
    if (!vendorSlug || !productSlug || !productName) return null;

    // category falls back from the source column name (strip _ids).
    const category = ref.category || sourceCol.replace(/_ids$/, '');

    let vendor = (await client.query(
      'SELECT id FROM vendors WHERE slug = $1',
      [vendorSlug]
    )).rows[0];
    if (!vendor) {
      vendor = (await client.query(
        `INSERT INTO vendors (name, slug, needs_review) VALUES ($1, $2, TRUE) RETURNING id`,
        [vendorName, vendorSlug]
      )).rows[0];
    }

    let product = (await client.query(
      'SELECT id FROM vendor_products WHERE vendor_id = $1 AND slug = $2',
      [vendor.id, productSlug]
    )).rows[0];
    if (!product) {
      product = (await client.query(
        `INSERT INTO vendor_products (vendor_id, name, slug, category, needs_review)
         VALUES ($1, $2, $3, $4, TRUE) RETURNING id`,
        [vendor.id, productName, productSlug, category]
      )).rows[0];
    }
    return product.id;
  }

  async _upsertPartners(client, accountId, partners, tally) {
    const out = [];
    for (const p of partners) {
      if (!p?.slug) continue;
      const partnerInfo = await this._findOrCreatePartnerAccount(client, p, tally);

      // Link partner to the customer account (idempotent).
      await client.query(
        `INSERT INTO account_partners (customer_account_id, partner_account_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [accountId, partnerInfo.id]
      );

      // Upsert partner contacts and link to the partner account.
      for (const c of p.contacts || []) {
        const contactId = await this._upsertContactRow(client, c, 'partner');
        await client.query(
          `INSERT INTO account_contacts (account_id, contact_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [partnerInfo.id, contactId]
        );
      }
      out.push(partnerInfo);
    }
    return out;
  }

  async _findOrCreatePartnerAccount(client, p, tally) {
    const existing = this.accountsService
      ? await this.accountsService._findExisting(client, { slug: p.slug, name: p.name })
      : (await client.query('SELECT id FROM accounts WHERE slug = $1', [p.slug])).rows[0];
    if (existing) return { id: existing.id, created: false };

    const ins = await client.query(
      `INSERT INTO accounts (user_id, slug, name, status, domains)
       VALUES (current_setting('app.current_user_id')::bigint, $1, $2, $3, '[]'::jsonb)
       RETURNING id`,
      [p.slug, p.name || p.slug, p.status || 'partner']
    );
    tally.partners++;
    return { id: ins.rows[0].id, created: true };
  }

  async _upsertContacts(client, accountId, contacts, tally, updated) {
    const map = new Map();
    for (const c of contacts) {
      const id = await this._upsertContactRow(client, c, 'account');
      await client.query(
        `INSERT INTO account_contacts (account_id, contact_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [accountId, id]
      );
      map.set(this._contactKey(c), id);
      if (c.email) map.set(this._emailKey(c.email), id);
    }
    return map;
  }

  // Delegates the match step to ContactsService._findExisting (email-first,
  // then full_name+kind), then either creates a new row or PATCH-merges
  // non-null portable fields into the matched row.
  async _upsertContactRow(client, c, defaultKind) {
    const kind = c.kind || defaultKind || 'account';
    const lookup = { email: c.email, full_name: c.full_name, kind };
    let existing = this.contactsService
      ? await this.contactsService._findExisting(client, lookup)
      : null;
    if (!existing && !this.contactsService) {
      // Fallback path when the service wasn't injected. Mirrors _findExisting.
      if (c.email) {
        existing = (await client.query(
          'SELECT id FROM contacts WHERE LOWER(email) = LOWER($1) LIMIT 1',
          [c.email]
        )).rows[0];
      }
      if (!existing && c.full_name) {
        existing = (await client.query(
          'SELECT id FROM contacts WHERE full_name = $1 AND kind = $2 LIMIT 1',
          [c.full_name, kind]
        )).rows[0];
      }
    }

    if (!existing) {
      // Route creation through the shared insert so there is exactly one
      // `INSERT INTO contacts` in the codebase. Import keeps its own strict
      // match (above) and authoritative merge (below) — only the create is
      // shared. The raw INSERT remains as a fallback for the (defensive) path
      // where no ContactsService was injected.
      if (this.contactsService) {
        return this.contactsService._insertRow(client, c, kind);
      }
      const ins = await client.query(
        `INSERT INTO contacts (user_id, full_name, company, title, email, phone, linkedin,
                               notes, kind, location_raw, city, state, country)
         VALUES (current_setting('app.current_user_id')::bigint,
                 $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id`,
        [
          c.full_name, c.company || null, c.title || null, c.email || null,
          c.phone || null, c.linkedin || null, c.notes || null, kind,
          c.location_raw || null, c.city || null, c.state || null, c.country || null,
        ]
      );
      return ins.rows[0].id;
    }

    const fields = [];
    const params = [existing.id];
    const set = (col, val) => { params.push(val); fields.push(`${col} = $${params.length}`); };
    for (const col of CONTACT_PORTABLE_COLS) {
      if (c[col] != null && col !== 'kind') set(col, c[col]);
    }
    if (fields.length > 0) {
      await client.query(`UPDATE contacts SET ${fields.join(', ')} WHERE id = $1`, params);
    }
    return existing.id;
  }

  _contactKey(c) {
    if (c.email) return `email:${c.email.toLowerCase()}`;
    return `name:${(c.full_name || '').toLowerCase()}`;
  }

  _emailKey(email) {
    return `email:${email.toLowerCase()}`;
  }

  // Build email→id and full_name→id maps from the contacts linked to ONE
  // account. Meeting attendee refs are resolved against this (not the whole
  // tenant) so only an account's own profile contacts get re-linked to its
  // meetings; unlinked attendees in the bundle are dropped, never created.
  async _buildAccountContactLookup(client, accountId) {
    const rows = (await client.query(
      `SELECT c.id, c.full_name, c.email
       FROM contacts c
       JOIN account_contacts ac ON ac.contact_id = c.id
       WHERE ac.account_id = $1`,
      [accountId]
    )).rows;
    const byEmail = new Map();
    const byName = new Map();
    for (const r of rows) {
      if (r.email) byEmail.set(r.email.toLowerCase(), r.id);
      if (r.full_name) byName.set(r.full_name.toLowerCase(), r.id);
    }
    return { byEmail, byName };
  }

  async _upsertMeetings(client, accountId, meetings, lookup, tally, updated) {
    for (const m of meetings) {
      if (!m?.date || !m?.body) continue;
      // Internal-only meetings are not included on the per-account export, but
      // we tolerate them if present by ignoring them (no account link).
      if (m.internal) continue;

      const filename = m.filename || deriveFilename(m.date, m.title);
      const existing = (await client.query(
        'SELECT id FROM meetings WHERE account_id = $1 AND filename = $2',
        [accountId, filename]
      )).rows[0];

      let meetingId;
      if (!existing) {
        const ins = await client.query(
          `INSERT INTO meetings (user_id, account_id, date, title, filename, body, internal)
           VALUES (current_setting('app.current_user_id')::bigint, $1, $2, $3, $4, $5, false)
           RETURNING id`,
          [accountId, m.date, m.title || null, filename, m.body]
        );
        meetingId = ins.rows[0].id;
        tally.meetings++;
      } else {
        await client.query(
          `UPDATE meetings SET date = $2, title = $3, body = $4 WHERE id = $1`,
          [existing.id, m.date, m.title || null, m.body]
        );
        meetingId = existing.id;
        updated.meetings++;
      }

      // Re-establish attendee links ONLY for people who are contacts on THIS
      // account (the profile contacts upserted above — `lookup` is scoped to
      // them). Attendees who were never linked to the account are intentionally
      // dropped rather than recreated as standalone "filler" contacts in the
      // destination tenant; those are the ones that don't matter.
      const attendeeIds = [];
      for (const ref of m.attendee_refs || []) {
        let id = null;
        if (ref.email) id = lookup.byEmail.get(ref.email.toLowerCase());
        if (!id && ref.full_name) id = lookup.byName.get(ref.full_name.toLowerCase());
        if (id) attendeeIds.push(id);
      }
      if (attendeeIds.length > 0) {
        await client.query('DELETE FROM meeting_attendees WHERE meeting_id = $1', [meetingId]);
        for (const cid of attendeeIds) {
          await client.query(
            'INSERT INTO meeting_attendees (meeting_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [meetingId, cid]
          );
        }
      }
    }
  }

  async _upsertOpportunities(client, accountId, opps, tally, updated) {
    for (const o of opps) {
      if (!o?.name) continue;

      const existing = (await client.query(
        'SELECT id FROM opportunities WHERE account_id = $1 AND name = $2',
        [accountId, o.name]
      )).rows[0];

      let oppId;
      if (!existing) {
        const ins = await client.query(
          `INSERT INTO opportunities (
             user_id, account_id, name, opp_link, trr_link, tech_validation_link, stage, notes,
             why_change, why_now, why_us
           ) VALUES (
             current_setting('app.current_user_id')::bigint,
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
           ) RETURNING id`,
          [
            accountId, o.name,
            o.opp_link || null, o.trr_link || null, o.tech_validation_link || null,
            o.stage || 'opp_identification', o.notes || null,
            o.why_change || [], o.why_now || [], o.why_us || [],
          ]
        );
        oppId = ins.rows[0].id;
        tally.opportunities++;
      } else {
        await client.query(
          `UPDATE opportunities SET
             opp_link = COALESCE($2, opp_link),
             trr_link = COALESCE($3, trr_link),
             tech_validation_link = COALESCE($4, tech_validation_link),
             stage = COALESCE($5, stage),
             notes = COALESCE($6, notes),
             why_change = COALESCE($7, why_change),
             why_now = COALESCE($8, why_now),
             why_us = COALESCE($9, why_us)
           WHERE id = $1`,
          [
            existing.id,
            o.opp_link || null,
            o.trr_link || null,
            o.tech_validation_link || null,
            o.stage || null,
            o.notes || null,
            o.why_change || null,
            o.why_now || null,
            o.why_us || null,
          ]
        );
        oppId = existing.id;
        updated.opportunities++;
      }

      // Replace product links.
      if (Array.isArray(o.products)) {
        const productIds = [];
        for (const p of o.products) {
          if (!p?.name) continue;
          const productId = await this._upsertProduct(client, p, tally);
          productIds.push(productId);
        }
        await client.query('DELETE FROM opp_products WHERE opportunity_id = $1', [oppId]);
        for (const pid of productIds) {
          await client.query(
            'INSERT INTO opp_products (opportunity_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [oppId, pid]
          );
        }
      }
    }
  }

  async _upsertProduct(client, p, tally) {
    let categoryId = null;
    if (p.category_name) {
      const existingCat = (await client.query(
        `SELECT id FROM product_categories
         WHERE user_id = current_setting('app.current_user_id')::bigint AND name = $1`,
        [p.category_name]
      )).rows[0];
      if (existingCat) {
        categoryId = existingCat.id;
      } else {
        categoryId = (await client.query(
          `INSERT INTO product_categories (user_id, name)
           VALUES (current_setting('app.current_user_id')::bigint, $1) RETURNING id`,
          [p.category_name]
        )).rows[0].id;
      }
    }

    const existing = (await client.query(
      `SELECT id FROM products
       WHERE user_id = current_setting('app.current_user_id')::bigint AND name = $1`,
      [p.name]
    )).rows[0];
    if (existing) {
      if (categoryId != null) {
        await client.query(
          'UPDATE products SET category_id = $2 WHERE id = $1 AND category_id IS NULL',
          [existing.id, categoryId]
        );
      }
      return existing.id;
    }
    const ins = await client.query(
      `INSERT INTO products (user_id, name, category_id)
       VALUES (current_setting('app.current_user_id')::bigint, $1, $2) RETURNING id`,
      [p.name, categoryId]
    );
    tally.products++;
    return ins.rows[0].id;
  }
}
