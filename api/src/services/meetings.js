import { withUser } from '../db/connection.js';
import { deriveFilename } from './_slug.js';

const MEETING_COLS = 'id, account_id, date, title, filename, body, internal, needs_review, created_at, updated_at';

function normalizeDomain(d) {
  if (!d || typeof d !== 'string') return null;
  return d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '') || null;
}

// Parse a free-form list of email strings into deduped
// { email, domain, name_guess } records. Designed to be forgiving — calendar
// invites paste in lots of different shapes:
//   - bare emails:                          "jane@acme.com"
//   - RFC-5322 addr-spec:                   "Jane Doe <jane@acme.com>"
//   - quoted display names (incl. commas):  '"Smith, John" <jsmith@acme.com>'
//   - mixed comma / semicolon / newline separation
//   - leading/trailing prose ("Attendees: a@x.com, B <b@x.com>. Thanks.")
//
// Strategy: don't pre-split (a comma inside a quoted display name would
// shred it). Instead, scan the input directly for emails:
//   pass 1 finds 'Name <email>' forms and captures the display name from
//   whatever immediately precedes the angle bracket;
//   pass 2 picks up any remaining bare emails the first pass didn't claim.
export function parseEmailList(text) {
  if (!text) return [];
  const seen = new Map();
  const EMAIL_BODY = '[A-Z0-9._%+\\-]+@[A-Z0-9.\\-]+\\.[A-Z]{2,}';

  function add(email, displayName) {
    const e = String(email || '').toLowerCase();
    if (!e || seen.has(e)) return;
    const cleaned = String(displayName || '')
      .replace(/^[\s,;]+|[\s,;.]+$/g, '')
      .replace(/^["']|["']$/g, '')
      .trim();
    const [local, domainRaw] = e.split('@');
    const domain = normalizeDomain(domainRaw);
    const nameGuess = cleaned || local
      .replace(/[._\-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, c => c.toUpperCase());
    seen.set(e, { email: e, domain, name_guess: nameGuess });
  }

  // Pass 1: "Display Name <email>" — quoted name preserved intact (including
  // any commas inside the quotes), unquoted display bounded by `,;<\n` so it
  // can't slurp text from the previous attendee.
  const bracketRe = new RegExp(
    `(?:"([^"]+)"|'([^']+)'|([^<,;\\n]*?))\\s*<\\s*(${EMAIL_BODY})\\s*>`,
    'gi'
  );
  const remainder = String(text).replace(bracketRe, (_full, q1, q2, plain, email) => {
    add(email, q1 || q2 || plain || '');
    // Blank out the matched span so pass 2 doesn't re-grab the same email.
    return ' '.repeat(_full.length);
  });

  // Pass 2: any bare emails left over (no angle brackets around them).
  const bareRe = new RegExp(EMAIL_BODY, 'gi');
  let m;
  while ((m = bareRe.exec(remainder)) !== null) {
    add(m[0], '');
  }

  return [...seen.values()];
}

export class MeetingsService {
  constructor({ contactsService = null, accountsService = null, contactEnrichmentService = null, internalDomainsService = null } = {}) {
    this.contactsService = contactsService;
    this.accountsService = accountsService;
    this.contactEnrichmentService = contactEnrichmentService;
    this.internalDomainsService = internalDomainsService;
  }

  async getAll(userId, { limit = 50, offset = 0, internal, needs_review } = {}) {
    return withUser(userId, async (client) => {
      const where = [];
      const params = [];
      if (internal === true)  { where.push('m.internal = true'); }
      if (internal === false) { where.push('m.internal = false'); }
      if (needs_review === true)  { where.push('m.needs_review = true'); }
      if (needs_review === false) { where.push('m.needs_review = false'); }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      params.push(limit, offset);
      const meetings = (await client.query(`
        SELECT m.id, m.account_id, m.date, m.title, m.filename, m.internal, m.needs_review,
               m.created_at, m.updated_at,
               a.slug AS account_slug, a.name AS account_name
        FROM meetings m
        LEFT JOIN accounts a ON a.id = m.account_id
        ${whereSql}
        ORDER BY m.date DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `, params)).rows;

      for (const m of meetings) {
        await this._attachAttendees(client, m);
      }
      return meetings;
    });
  }

  async getByAccount(userId, accountId) {
    return withUser(userId, async (client) => {
      const meetings = (await client.query(
        `SELECT ${MEETING_COLS} FROM meetings WHERE account_id = $1 ORDER BY date DESC`,
        [accountId]
      )).rows;
      for (const m of meetings) {
        await this._attachAttendees(client, m);
      }
      return meetings;
    });
  }

  // Load a meeting's attendees (linked contacts + unlinked display-name rows)
  // and attach them to the meeting object:
  //   m.contacts           — linked contacts (back-compat with the old shape)
  //   m.unlinked_attendees — [{ attendee_id, display_name, email }] awaiting a link
  //   m.attendees          — display string of everyone, linked first. Replaces
  //                          the retired free-text column so readers and the GUI
  //                          keep seeing `attendees` as a string.
  async _attachAttendees(client, meeting) {
    const rows = (await client.query(`
      SELECT ma.id AS attendee_id, ma.contact_id, ma.display_name, ma.email,
             c.full_name, c.company, c.title, c.email AS contact_email, c.phone, c.linkedin
      FROM meeting_attendees ma
      LEFT JOIN contacts c ON c.id = ma.contact_id
      WHERE ma.meeting_id = $1
      ORDER BY (ma.contact_id IS NULL), c.full_name, ma.display_name
    `, [meeting.id])).rows;

    meeting.contacts = rows
      .filter((r) => r.contact_id)
      .map((r) => ({
        id: r.contact_id, full_name: r.full_name, company: r.company,
        title: r.title, email: r.contact_email, phone: r.phone, linkedin: r.linkedin,
      }));
    meeting.unlinked_attendees = rows
      .filter((r) => !r.contact_id)
      .map((r) => ({ attendee_id: r.attendee_id, display_name: r.display_name, email: r.email }));
    meeting.attendees = rows.map((r) => r.full_name || r.display_name).filter(Boolean).join(', ');
    return meeting;
  }

  async getById(userId, id) {
    return withUser(userId, (client) => this._fetchFull(client, id));
  }

  async _fetchFull(client, id) {
    const meeting = (await client.query(
      `SELECT ${MEETING_COLS} FROM meetings WHERE id = $1`,
      [id]
    )).rows[0];
    if (!meeting) return null;

    let account = null;
    if (meeting.account_id) {
      account = (await client.query(
        'SELECT slug, name FROM accounts WHERE id = $1',
        [meeting.account_id]
      )).rows[0];
    }

    meeting.account_slug = account?.slug || null;
    meeting.account_name = account?.name || null;
    await this._attachAttendees(client, meeting);
    return meeting;
  }

  async create(userId, accountId, data) {
    const internal = !!data.internal;
    if (internal && accountId) {
      throw Object.assign(new Error('Internal meetings cannot have an account_id.'), { statusCode: 400 });
    }
    if (!internal && !accountId) {
      throw Object.assign(new Error('Non-internal meetings require an account_id.'), { statusCode: 400 });
    }

    return withUser(userId, async (client) => {
      const filename = deriveFilename(data.date, data.title, data.filename);
      const contactIds = data.contact_ids || [];

      if (contactIds.length > 0) {
        const found = await client.query(
          'SELECT id FROM contacts WHERE id = ANY($1::bigint[])',
          [contactIds]
        );
        if (found.rows.length !== contactIds.length) {
          const foundIds = new Set(found.rows.map(r => Number(r.id)));
          const missing = contactIds.filter(cid => !foundIds.has(Number(cid)));
          throw Object.assign(new Error(`Contacts not found: ids=${missing.join(', ')}. Contacts must exist before being attached to a meeting — create them first via the contacts tool, or use contacts.attendee_options (mode="external", account_id=this account) to pick from the valid set for this account.`), { statusCode: 400 });
        }
      }

      const res = await client.query(
        `INSERT INTO meetings (user_id, account_id, date, title, filename, body, internal, needs_review)
         VALUES (current_setting('app.current_user_id')::bigint, $1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          internal ? null : accountId,
          data.date,
          data.title || null,
          filename,
          data.body,
          internal,
          !!data.needs_review,
        ]
      );
      const meetingId = res.rows[0].id;

      await this._linkContacts(client, meetingId, contactIds);
      await this._addUnlinked(client, meetingId, { attendeesText: data.attendees, unlinked: data.unlinked_attendees });
      return this._fetchFull(client, meetingId);
    });
  }

  async update(userId, id, data) {
    return withUser(userId, async (client) => {
      const existing = (await client.query(
        `SELECT ${MEETING_COLS} FROM meetings WHERE id = $1`,
        [id]
      )).rows[0];
      if (!existing) return null;

      const contactIds = data.contact_ids;
      if (contactIds && contactIds.length > 0) {
        const found = await client.query(
          'SELECT id FROM contacts WHERE id = ANY($1::bigint[])',
          [contactIds]
        );
        if (found.rows.length !== contactIds.length) {
          const foundIds = new Set(found.rows.map(r => Number(r.id)));
          const missing = contactIds.filter(cid => !foundIds.has(Number(cid)));
          throw Object.assign(new Error(`Contacts not found: ids=${missing.join(', ')}. Contacts must exist before being attached to a meeting — create them first via the contacts tool, or use contacts.attendee_options (mode="external", account_id=this account) to pick from the valid set for this account.`), { statusCode: 400 });
        }
      }

      const nextDate = data.date || existing.date;
      const nextTitle = data.title !== undefined ? data.title : existing.title;
      const nextFilename = data.filename
        ? deriveFilename(nextDate, nextTitle, data.filename)
        : existing.filename;
      const nextNeedsReview = data.needs_review !== undefined ? !!data.needs_review : existing.needs_review;

      await client.query(
        `UPDATE meetings SET
           date = $2, title = $3, filename = $4,
           body = $5, needs_review = $6
         WHERE id = $1`,
        [
          id,
          nextDate,
          nextTitle,
          nextFilename,
          data.body || existing.body,
          nextNeedsReview,
        ]
      );

      // Linked and unlinked attendees are managed independently so updating one
      // doesn't wipe the other. contact_ids replaces the linked set; an
      // attendees string / unlinked_attendees array replaces the unlinked set.
      if (contactIds !== undefined) {
        await client.query('DELETE FROM meeting_attendees WHERE meeting_id = $1 AND contact_id IS NOT NULL', [id]);
        await this._linkContacts(client, id, contactIds || []);
      }
      if (data.attendees !== undefined || data.unlinked_attendees !== undefined) {
        await client.query('DELETE FROM meeting_attendees WHERE meeting_id = $1 AND contact_id IS NULL', [id]);
        await this._addUnlinked(client, id, { attendeesText: data.attendees, unlinked: data.unlinked_attendees });
      }
      return this._fetchFull(client, id);
    });
  }

  async delete(userId, id) {
    return withUser(userId, async (client) => {
      const existing = (await client.query(
        `SELECT ${MEETING_COLS} FROM meetings WHERE id = $1`,
        [id]
      )).rows[0];
      if (!existing) return null;
      await client.query('DELETE FROM meetings WHERE id = $1', [id]);
      return existing;
    });
  }

  // Link existing contacts as attendees (linked rows). Callers validate the
  // contact ids exist first.
  async _linkContacts(client, meetingId, contactIds) {
    for (const contactId of contactIds || []) {
      await client.query(
        'INSERT INTO meeting_attendees (meeting_id, contact_id) VALUES ($1, $2)',
        [meetingId, contactId]
      );
    }
  }

  // Add unlinked attendees (a name, optionally an email, no contact yet) from a
  // free-text `attendeesText` (split on , or ;) and/or an explicit `unlinked`
  // array. Skips any name already represented by a linked contact on this
  // meeting so the same person isn't listed twice. This is where the retired
  // free-text column's content now lands — and how the import pipeline records
  // who was in the room without spawning a contact per attendee.
  async _addUnlinked(client, meetingId, { attendeesText = null, unlinked = [] } = {}) {
    const linkedNames = new Set(
      (await client.query(
        `SELECT lower(c.full_name) AS n
         FROM meeting_attendees ma JOIN contacts c ON c.id = ma.contact_id
         WHERE ma.meeting_id = $1`,
        [meetingId]
      )).rows.map((r) => r.n).filter(Boolean)
    );

    const candidates = [];
    for (const u of unlinked || []) {
      const name = (u?.display_name || u?.name || '').trim();
      if (name) candidates.push({ name, email: u.email || null });
    }
    if (typeof attendeesText === 'string') {
      for (const tok of attendeesText.split(/[,;]/)) {
        const name = tok.trim();
        if (name) candidates.push({ name, email: null });
      }
    }

    const seen = new Set();
    for (const c of candidates) {
      const key = c.name.toLowerCase();
      if (linkedNames.has(key) || seen.has(key)) continue;
      seen.add(key);
      await client.query(
        'INSERT INTO meeting_attendees (meeting_id, display_name, email) VALUES ($1, $2, $3)',
        [meetingId, c.name, c.email]
      );
    }
  }

  // Triage: attach a parked (account-less, needs_review) note to an account.
  // The one path allowed to set account_id after creation — flips the note from
  // internal to a real account meeting and clears the review flag.
  async assignAccount(userId, id, accountId) {
    return withUser(userId, async (client) => {
      const m = (await client.query('SELECT id, account_id FROM meetings WHERE id = $1', [id])).rows[0];
      if (!m) return null;
      if (m.account_id) {
        throw Object.assign(new Error(`Meeting ${id} is already linked to account ${m.account_id}. Account assignment only applies to unassigned notes.`), { statusCode: 409 });
      }
      const acct = (await client.query('SELECT id FROM accounts WHERE id = $1', [accountId])).rows[0];
      if (!acct) {
        throw Object.assign(new Error(`Account not found: id=${accountId}.`), { statusCode: 404 });
      }
      await client.query(
        'UPDATE meetings SET account_id = $2, internal = false, needs_review = false WHERE id = $1',
        [id, accountId]
      );
      return this._fetchFull(client, id);
    });
  }

  // Triage: link an unlinked attendee row to a contact. If the contact is
  // already an attendee on this meeting, the unlinked row is dropped (dedupe)
  // rather than creating a duplicate link.
  async linkAttendee(userId, meetingId, attendeeId, contactId) {
    return withUser(userId, async (client) => {
      const att = (await client.query(
        'SELECT id, contact_id FROM meeting_attendees WHERE id = $1 AND meeting_id = $2',
        [attendeeId, meetingId]
      )).rows[0];
      if (!att) return null;
      const contact = (await client.query('SELECT id FROM contacts WHERE id = $1', [contactId])).rows[0];
      if (!contact) {
        throw Object.assign(new Error(`Contact not found: id=${contactId}.`), { statusCode: 404 });
      }
      const dup = (await client.query(
        'SELECT id FROM meeting_attendees WHERE meeting_id = $1 AND contact_id = $2',
        [meetingId, contactId]
      )).rows[0];
      if (dup) {
        await client.query('DELETE FROM meeting_attendees WHERE id = $1', [attendeeId]);
      } else {
        await client.query(
          'UPDATE meeting_attendees SET contact_id = $2, display_name = NULL, email = NULL WHERE id = $1',
          [attendeeId, contactId]
        );
      }
      return this._fetchFull(client, meetingId);
    });
  }

  // Given a list of email strings (raw or RFC-5322), return what we already
  // know about each one and how the GUI/agent should treat them in the
  // from-emails meeting flow. No writes — pure resolution. Output:
  //   {
  //     attendees: [{ email, domain, name_guess, kind, contact, account_match }],
  //     accounts:  [{ domain, account, attendee_count, suggested_name }],
  //     primary_domain: <best external candidate>,
  //   }
  async resolveEmails(userId, emails) {
    if (!this.contactsService || !this.accountsService) {
      throw new Error('MeetingsService.resolveEmails requires contactsService and accountsService deps');
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
      const contact = await this.contactsService.getByEmail(userId, p.email);
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
      const account = await this.accountsService.getByDomain(userId, domain);
      accounts.push({
        domain,
        account: account || null,
        attendee_count: count,
        suggested_name: account ? account.name : suggestAccountName(domain),
      });
    }
    accounts.sort((a, b) => b.attendee_count - a.attendee_count || a.domain.localeCompare(b.domain));
    const primary = accounts[0]?.domain || null;

    // Attach the matched account to each external attendee so the GUI doesn't
    // have to cross-reference.
    for (const a of attendees) {
      if (a.kind !== 'account' || !a.domain) { a.account_match = null; continue; }
      const candidate = accounts.find(c => c.domain === a.domain);
      a.account_match = candidate?.account || null;
    }

    return { attendees, accounts, primary_domain: primary };
  }

  // Create a meeting from a resolved email list. The caller is expected to
  // have run resolveEmails first; this endpoint just persists the user's
  // choices and fires off enrichment.
  //
  // Payload shape:
  //   {
  //     date, title, body, attendees_text,
  //     account: { mode: 'existing'|'new', account_id?, name?, domain? },
  //     contacts: [
  //       { mode: 'existing', contact_id, link_to_account? } |
  //       { mode: 'new', full_name, email, kind?, research? }
  //     ]
  //   }
  async createFromEmails(userId, payload) {
    if (!this.contactsService || !this.accountsService) {
      throw new Error('MeetingsService.createFromEmails requires contactsService and accountsService deps');
    }
    if (!payload?.date) throw Object.assign(new Error('payload.date is required (ISO date string, e.g. "2026-05-20").'), { statusCode: 400 });
    if (!payload?.body) throw Object.assign(new Error('payload.body is required (the meeting notes as markdown text).'), { statusCode: 400 });
    if (!payload?.account?.mode) throw Object.assign(new Error('payload.account.mode is required: "existing" (also pass account_id of a matched account) or "new" (also pass name and optional domain — a fresh account row will be created).'), { statusCode: 400 });

    // 1) Resolve/create the account.
    let accountId;
    if (payload.account.mode === 'existing') {
      if (!payload.account.account_id) {
        throw Object.assign(new Error('payload.account.account_id is required when account.mode="existing". Use resolve_emails to get the matched account candidate id, or look up the account via the accounts tool.'), { statusCode: 400 });
      }
      const acct = await this.accountsService.getById(userId, payload.account.account_id);
      if (!acct) throw Object.assign(new Error(`Account not found: id=${payload.account.account_id}. Use the accounts tool (list/search/get) to find the right id, or switch to account.mode="new" with a name.`), { statusCode: 404 });
      accountId = acct.id;
      // If the user typed a domain that isn't yet on the account, append it.
      if (payload.account.domain) {
        const domain = normalizeDomain(payload.account.domain);
        const existingDomains = Array.isArray(acct.domains) ? acct.domains : [];
        if (domain && !existingDomains.includes(domain)) {
          await this.accountsService.patch(userId, acct.id, {
            domains: [...existingDomains, domain],
          });
        }
      }
    } else if (payload.account.mode === 'new') {
      if (!payload.account.name) {
        throw Object.assign(new Error('payload.account.name is required when account.mode="new" (the company display name — the slug is derived automatically). Optional: payload.account.domain to populate the domains array.'), { statusCode: 400 });
      }
      const slug = slugifyName(payload.account.name);
      const domain = normalizeDomain(payload.account.domain || '');
      const created = await this.accountsService.create(userId, {
        name: payload.account.name,
        slug,
        domains: domain ? [domain] : [],
      });
      accountId = created.id;
    } else {
      throw Object.assign(new Error(`Unknown account.mode: "${payload.account.mode}". Must be "existing" (also pass account_id) or "new" (also pass name).`), { statusCode: 400 });
    }

    // 2) Resolve/create contacts. Collect the list for the meeting attendees +
    //    the list of new contacts to enrich.
    const contactIds = [];
    const enrichTargets = [];
    for (const c of payload.contacts || []) {
      if (c.mode === 'existing') {
        if (!c.contact_id) {
          throw Object.assign(new Error('contact.contact_id is required when contact.mode="existing". Use the contact ids returned by resolve_emails (or look them up via the contacts tool).'), { statusCode: 400 });
        }
        contactIds.push(c.contact_id);
        if (c.link_to_account) {
          try { await this.contactsService.linkAccount(userId, c.contact_id, accountId); }
          catch { /* idempotent — ignore conflict */ }
        }
      } else if (c.mode === 'new') {
        if (!c.full_name) {
          throw Object.assign(new Error('contact.full_name is required when contact.mode="new" (the person\'s display name). Optional: contact.email, contact.kind ("account" default | "partner" | "internal"), contact.research (true to enqueue background enrichment).'), { statusCode: 400 });
        }
        const kind = c.kind || 'account';
        const linkAccountId = kind === 'internal' ? null : accountId;
        const created = await this.contactsService.create(userId, {
          full_name: c.full_name,
          email: c.email || null,
          kind,
        }, linkAccountId);
        contactIds.push(created.id);
        if (c.research) {
          enrichTargets.push({ contactId: created.id, name: created.full_name });
        }
      } else {
        throw Object.assign(new Error(`Unknown contact.mode: "${c.mode}". Must be "existing" (also pass contact_id) or "new" (also pass full_name).`), { statusCode: 400 });
      }
    }

    // 3) Create the meeting.
    const meeting = await this.create(userId, accountId, {
      date: payload.date,
      title: payload.title || null,
      attendees: payload.attendees_text || null,
      body: payload.body,
      contact_ids: contactIds,
      internal: false,
    });

    // 4) Fire-and-forget enrichment for new contacts the user opted in for.
    //    Pulls account name from the just-created/-resolved account so the
    //    outreach lookup has the right disambiguator.
    let enrichmentJobIds = [];
    if (enrichTargets.length > 0 && this.contactEnrichmentService) {
      const acct = await this.accountsService.getById(userId, accountId);
      const accountName = acct?.name || null;
      for (const t of enrichTargets) {
        const jobId = this.contactEnrichmentService.enqueue(userId, {
          contactId: t.contactId,
          name: t.name,
          accountName,
        });
        enrichmentJobIds.push({ contact_id: t.contactId, enrichment_job_id: jobId });
      }
    }

    return { meeting, account_id: accountId, enrichment_jobs: enrichmentJobIds };
  }
}

function suggestAccountName(domain) {
  if (!domain) return '';
  // "acme-corp.com" → "Acme Corp"
  const base = domain.split('.').slice(0, -1).join('.') || domain;
  return base
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function slugifyName(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
