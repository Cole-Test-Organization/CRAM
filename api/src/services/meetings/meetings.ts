import type { PoolClient } from 'pg';
import { withUser } from '../../db/connection.js';
import { deriveFilename } from '../_shared/_slug.js';
import { badRequest, notFound, conflict } from '../../lib/http-error.js';

const MEETING_COLS = 'id, account_id, date, starts_at, ends_at, location, title, filename, body, internal, needs_review, krisp_meeting_id, created_at, updated_at';

export class MeetingsService {
  // Cross-service deps, wired loosely by the service bags (mcp/server.js,
  // agent/mcp-client.js) and defaulting to null when constructed bare.
  contactsService: any;
  accountsService: any;
  contactEnrichmentService: any;
  internalDomainsService: any;

  constructor({ contactsService = null, accountsService = null, contactEnrichmentService = null, internalDomainsService = null }: { contactsService?: any; accountsService?: any; contactEnrichmentService?: any; internalDomainsService?: any } = {}) {
    this.contactsService = contactsService;
    this.accountsService = accountsService;
    this.contactEnrichmentService = contactEnrichmentService;
    this.internalDomainsService = internalDomainsService;
  }

  async getAll(userId: number, { limit = 50, offset = 0, internal, needs_review }: { limit?: number; offset?: number; internal?: boolean; needs_review?: boolean } = {}) {
    return withUser(userId, async (client) => {
      const where: string[] = ['m.deleted_at IS NULL'];
      const params: any[] = [];
      if (internal === true)  { where.push('m.internal = true'); }
      if (internal === false) { where.push('m.internal = false'); }
      if (needs_review === true)  { where.push('m.needs_review = true'); }
      if (needs_review === false) { where.push('m.needs_review = false'); }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      params.push(limit, offset);
      const meetings = (await client.query(`
        SELECT m.id, m.account_id, m.date, m.starts_at, m.ends_at, m.location, m.title, m.filename, m.internal, m.needs_review,
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

  async getByAccount(userId: number, accountId: number) {
    return withUser(userId, async (client) => {
      const meetings = (await client.query(
        `SELECT ${MEETING_COLS} FROM meetings WHERE account_id = $1 AND deleted_at IS NULL ORDER BY date DESC`,
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
  //   m.contacts           — linked contacts (back-compat with the old shape),
  //                          each carrying their per-meeting `status` (RSVP /
  //                          attendance: going/declined/maybe/invited/owner, or
  //                          null when unknown)
  //   m.unlinked_attendees — [{ attendee_id, display_name, email, status }] awaiting a link
  //   m.attendees          — display string of everyone, linked first. Replaces
  //                          the retired free-text column so readers and the GUI
  //                          keep seeing `attendees` as a string.
  async _attachAttendees(client: PoolClient, meeting: any) {
    const rows = (await client.query(`
      SELECT ma.id AS attendee_id, ma.contact_id, ma.display_name, ma.email, ma.status,
             c.full_name, c.company, c.title, c.email AS contact_email, c.phone, c.linkedin
      FROM meeting_attendees ma
      LEFT JOIN contacts c ON c.id = ma.contact_id
      WHERE ma.meeting_id = $1
      ORDER BY (ma.contact_id IS NULL), c.full_name, ma.display_name
    `, [meeting.id])).rows;

    meeting.contacts = rows
      .filter((r: any) => r.contact_id)
      .map((r: any) => ({
        id: r.contact_id, full_name: r.full_name, company: r.company,
        title: r.title, email: r.contact_email, phone: r.phone, linkedin: r.linkedin,
        status: r.status,
      }));
    meeting.unlinked_attendees = rows
      .filter((r: any) => !r.contact_id)
      .map((r: any) => ({ attendee_id: r.attendee_id, display_name: r.display_name, email: r.email, status: r.status }));
    meeting.attendees = rows.map((r: any) => r.full_name || r.display_name).filter(Boolean).join(', ');
    return meeting;
  }

  async getById(userId: number, id: number) {
    return withUser(userId, (client) => this._fetchFull(client, id));
  }

  // Look up an existing meeting for this user by its stable `filename`, REGARDLESS
  // of account_id. The two unique indexes that back filename idempotency are
  // partitioned — meetings_account_filename_uniq (account_id, filename) WHERE
  // account_id IS NOT NULL and meetings_internal_filename_uniq (user_id, filename)
  // WHERE account_id IS NULL — so a row that crosses partitions (parked ↔ linked)
  // does NOT collide. Callers that need import idempotency tied to the filename
  // alone (notes-import) check here first instead of relying solely on a 23505.
  // RLS already scopes the query to this user; returns the row or null.
  async findByFilename(userId: number, filename: string) {
    if (!filename) return null;
    return withUser(userId, async (client) => {
      const res = await client.query(
        'SELECT id, account_id, internal, needs_review FROM meetings WHERE filename = $1 AND deleted_at IS NULL LIMIT 1',
        [filename]
      );
      return res.rows[0] || null;
    });
  }

  // Krisp idempotency/linkage: find the LIVE meeting carrying this Krisp meeting
  // id. Set on first import and carried onto the surviving row across a merge, so
  // a re-delivery or a follow-up event (e.g. the transcript after the note) folds
  // into the same meeting instead of spawning a duplicate. Returns the full row.
  async findByKrispMeetingId(userId: number, krispMeetingId: string) {
    if (!krispMeetingId) return null;
    return withUser(userId, async (client) => {
      const res = await client.query(
        `SELECT ${MEETING_COLS} FROM meetings WHERE krisp_meeting_id = $1 AND deleted_at IS NULL LIMIT 1`,
        [krispMeetingId]
      );
      return res.rows[0] || null;
    });
  }

  // Candidate meetings for time-proximity matching (the Krisp webhook): LIVE
  // meetings whose start instant falls within ±windowMs of `startsAtIso`. Returns
  // the light fields the matcher needs (id, starts_at, ends_at, title,
  // account_id, internal). The caller picks the winner (start proximity + overlap
  // tiebreak); we just do the cheap index-backed range scan. Bounds are computed
  // in JS so the query is a plain BETWEEN that uses idx_meetings_starts_at.
  async findTimeMatchCandidates(userId: number, startsAtIso: string, windowMs: number) {
    if (!startsAtIso) return [];
    const center = new Date(startsAtIso).getTime();
    if (Number.isNaN(center)) return [];
    const lo = new Date(center - windowMs).toISOString();
    const hi = new Date(center + windowMs).toISOString();
    return withUser(userId, async (client) => {
      const res = await client.query(
        `SELECT id, starts_at, ends_at, title, account_id, internal
           FROM meetings
          WHERE deleted_at IS NULL
            AND starts_at IS NOT NULL
            AND starts_at BETWEEN $1::timestamptz AND $2::timestamptz
          ORDER BY starts_at`,
        [lo, hi]
      );
      return res.rows;
    });
  }

  // Soft-delete (tombstone) a meeting — used by the merge feature to retire the
  // absorbed row non-destructively (its un-pulled fields remain recoverable).
  // Distinct from delete() (hard delete for an explicit user delete). Returns the
  // tombstoned row or null if it wasn't live.
  async softDelete(userId: number, id: number) {
    return withUser(userId, async (client) => {
      const res = await client.query(
        'UPDATE meetings SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id',
        [id]
      );
      return res.rows[0] || null;
    });
  }

  async _fetchFull(client: PoolClient, id: number) {
    const meeting = (await client.query(
      `SELECT ${MEETING_COLS} FROM meetings WHERE id = $1 AND deleted_at IS NULL`,
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

  async create(userId: number, accountId: number | null, data: any) {
    const internal = !!data.internal;
    if (internal && accountId) {
      throw badRequest('Internal meetings cannot have an account_id.');
    }
    if (!internal && !accountId) {
      throw badRequest('Non-internal meetings require an account_id.');
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
          const missing = contactIds.filter((cid: any) => !foundIds.has(Number(cid)));
          throw badRequest(`Contacts not found: ids=${missing.join(', ')}. Contacts must exist before being attached to a meeting — create them first via the contacts tool, or use contacts.attendee_options (mode="external", account_id=this account) to pick from the valid set for this account.`);
        }
      }

      const res = await client.query(
        `INSERT INTO meetings (user_id, account_id, date, starts_at, ends_at, location, title, filename, body, internal, needs_review, krisp_meeting_id)
         VALUES (current_setting('app.current_user_id')::bigint, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          internal ? null : accountId,
          data.date,
          data.starts_at || null,
          data.ends_at || null,
          data.location || null,
          data.title || null,
          filename,
          data.body,
          internal,
          !!data.needs_review,
          data.krisp_meeting_id || null,
        ]
      );
      const meetingId = res.rows[0].id;

      await this._linkContacts(client, meetingId, contactIds, data.attendee_status || null);
      await this._addUnlinked(client, meetingId, { attendeesText: data.attendees, unlinked: data.unlinked_attendees });
      return this._fetchFull(client, meetingId);
    });
  }

  async update(userId: number, id: number, data: any) {
    return withUser(userId, async (client) => {
      const existing = (await client.query(
        `SELECT ${MEETING_COLS} FROM meetings WHERE id = $1 AND deleted_at IS NULL`,
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
          const missing = contactIds.filter((cid: any) => !foundIds.has(Number(cid)));
          throw badRequest(`Contacts not found: ids=${missing.join(', ')}. Contacts must exist before being attached to a meeting — create them first via the contacts tool, or use contacts.attendee_options (mode="external", account_id=this account) to pick from the valid set for this account.`);
        }
      }

      const nextDate = data.date || existing.date;
      const nextTitle = data.title !== undefined ? data.title : existing.title;
      const nextFilename = data.filename
        ? deriveFilename(nextDate, nextTitle, data.filename)
        : existing.filename;
      const nextNeedsReview = data.needs_review !== undefined ? !!data.needs_review : existing.needs_review;
      // starts_at/ends_at: undefined = leave as-is; null = explicitly clear; a
      // value = set. Lets the meeting form both set and unset a time of day
      // without disturbing the other fields.
      const nextStartsAt = data.starts_at !== undefined ? data.starts_at : existing.starts_at;
      const nextEndsAt = data.ends_at !== undefined ? data.ends_at : existing.ends_at;
      const nextLocation = data.location !== undefined ? data.location : existing.location;
      const nextKrispMeetingId = data.krisp_meeting_id !== undefined ? data.krisp_meeting_id : existing.krisp_meeting_id;

      await client.query(
        `UPDATE meetings SET
           date = $2, starts_at = $3, ends_at = $4, location = $5, title = $6, filename = $7,
           body = $8, needs_review = $9, krisp_meeting_id = $10
         WHERE id = $1`,
        [
          id,
          nextDate,
          nextStartsAt,
          nextEndsAt,
          nextLocation,
          nextTitle,
          nextFilename,
          data.body || existing.body,
          nextNeedsReview,
          nextKrispMeetingId,
        ]
      );

      // Linked and unlinked attendees are managed independently so updating one
      // doesn't wipe the other. contact_ids replaces the linked set; an
      // attendees string / unlinked_attendees array replaces the unlinked set.
      if (contactIds !== undefined) {
        await client.query('DELETE FROM meeting_attendees WHERE meeting_id = $1 AND contact_id IS NOT NULL', [id]);
        await this._linkContacts(client, id, contactIds || [], data.attendee_status || null);
      }
      if (data.attendees !== undefined || data.unlinked_attendees !== undefined) {
        await client.query('DELETE FROM meeting_attendees WHERE meeting_id = $1 AND contact_id IS NULL', [id]);
        await this._addUnlinked(client, id, { attendeesText: data.attendees, unlinked: data.unlinked_attendees });
      }
      return this._fetchFull(client, id);
    });
  }

  async delete(userId: number, id: number) {
    return withUser(userId, async (client) => {
      const existing = (await client.query(
        `SELECT ${MEETING_COLS} FROM meetings WHERE id = $1 AND deleted_at IS NULL`,
        [id]
      )).rows[0];
      if (!existing) return null;
      await client.query('DELETE FROM meetings WHERE id = $1', [id]);
      return existing;
    });
  }

  // Fill calendar-sourced fields (start/end timestamps, location) on an EXISTING
  // meeting without disturbing anything else — COALESCE means we only populate
  // columns that are currently NULL, never overwriting a value already set.
  // Matched by the stable calendar-derived `filename` AS STORED (the caller must
  // pass the same value deriveFilename produced on create — e.g. the slugified,
  // ".md"-suffixed "cal-<eventId>.md", NOT the raw "cal-<eventId>"). This is how
  // the idempotent calendar re-import backfills onto rows imported before time/
  // location capture existed: re-sending a day collides on the filename unique
  // index (the import reports it "skipped"), and this method lets those
  // skipped-but-stale rows still pick up their times and join link.
  //
  // The two filename unique indexes are PARTITIONED on (account_id IS NULL), so
  // the same filename can legitimately exist on several accounts AND as an
  // internal note. We therefore scope to the SAME partition the insert collided
  // with: pass `accountId` = the customer account the meeting was created under,
  // or null for an internal note. With a non-null id we match that exact
  // (account_id, filename) row; with null we match the (user_id, filename) row in
  // the account_id IS NULL partition. This makes a filename-only match impossible
  // to land on an unrelated account's row. Returns the updated row, or null if
  // nothing matched / nothing left to fill.
  async backfillCalendarFields(userId: number, filename: string, accountId: number | null, { starts_at = null, ends_at = null, location = null }: { starts_at?: string | null; ends_at?: string | null; location?: string | null } = {}) {
    if (!filename || (!starts_at && !ends_at && !location)) return null;
    return withUser(userId, async (client) => {
      const res = await client.query(
        `UPDATE meetings
            SET starts_at = COALESCE(starts_at, $3),
                ends_at   = COALESCE(ends_at,   $4),
                location  = COALESCE(location,  $5)
          WHERE filename = $1
            AND account_id IS NOT DISTINCT FROM $2
            AND (starts_at IS NULL OR ends_at IS NULL OR location IS NULL)
          RETURNING id, starts_at, ends_at, location`,
        [filename, accountId, starts_at, ends_at, location]
      );
      return res.rows[0] || null;
    });
  }

  // Link existing contacts as attendees (linked rows). Callers validate the
  // contact ids exist first. `statusById` (optional) maps a contact id →
  // canonical RSVP/attendance status ('going'|'declined'|'maybe'|'invited'|
  // 'owner'); contacts without an entry are linked with status NULL. Keyed by
  // String(id) so numeric and bigint-string ids both resolve.
  async _linkContacts(client: PoolClient, meetingId: number, contactIds: any[], statusById: Record<string, string | null> | null = null) {
    for (const contactId of contactIds || []) {
      const status = statusById ? (statusById[String(contactId)] ?? null) : null;
      await client.query(
        'INSERT INTO meeting_attendees (meeting_id, contact_id, status) VALUES ($1, $2, $3)',
        [meetingId, contactId, status]
      );
    }
  }

  // Add unlinked attendees (a name, optionally an email, no contact yet) from a
  // free-text `attendeesText` (split on , or ;) and/or an explicit `unlinked`
  // array. Skips any name already represented by a linked contact on this
  // meeting so the same person isn't listed twice. This is where the retired
  // free-text column's content now lands — and how the import pipeline records
  // who was in the room without spawning a contact per attendee.
  async _addUnlinked(client: PoolClient, meetingId: number, { attendeesText = null, unlinked = [] }: { attendeesText?: string | null; unlinked?: any[] } = {}) {
    const linkedNames = new Set(
      (await client.query(
        `SELECT lower(c.full_name) AS n
         FROM meeting_attendees ma JOIN contacts c ON c.id = ma.contact_id
         WHERE ma.meeting_id = $1`,
        [meetingId]
      )).rows.map((r: any) => r.n).filter(Boolean)
    );

    const candidates: { name: string; email: string | null }[] = [];
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
  // One of two paths allowed to set account_id after creation (the other is
  // reassignAccount) — flips the note from internal to a real account meeting
  // and clears the review flag. Deliberately guarded to account-less notes: an
  // agent placing parked notes must not clobber an existing assignment. To move
  // a meeting that ALREADY has an account, use reassignAccount.
  async assignAccount(userId: number, id: number, accountId: number) {
    return withUser(userId, async (client) => {
      const m = (await client.query('SELECT id, account_id FROM meetings WHERE id = $1 AND deleted_at IS NULL', [id])).rows[0];
      if (!m) return null;
      if (m.account_id) {
        throw conflict(`Meeting ${id} is already linked to account ${m.account_id}. Account assignment only applies to unassigned notes.`);
      }
      const acct = (await client.query('SELECT id FROM accounts WHERE id = $1', [accountId])).rows[0];
      if (!acct) {
        throw notFound(`Account not found: id=${accountId}.`);
      }
      await client.query(
        'UPDATE meetings SET account_id = $2, internal = false, needs_review = false WHERE id = $1',
        [id, accountId]
      );
      return this._fetchFull(client, id);
    });
  }

  // Reassign a meeting to a DIFFERENT account, or convert it to an internal
  // note — the "fix a bad import" path. Unlike assignAccount (triage, which only
  // touches account-less notes and 409s once a meeting has an account), this
  // works regardless of the meeting's current account: pass accountId to move it
  // there (internal=false), or internal=true to strip the account entirely and
  // make it an account-less internal note. Either way needs_review is cleared —
  // a deliberate move settles the triage question. Attendees are left untouched:
  // who was in the room is independent of which account owns the note. The
  // unique (account_id, filename) / (user_id, filename) partial indexes can
  // still collide if the destination already holds a same-named note — that's
  // surfaced as a 409 rather than a raw DB error.
  async reassignAccount(userId: number, id: number, { accountId = null, internal = false }: { accountId?: number | null; internal?: boolean } = {}) {
    const toInternal = !!internal;
    if (toInternal && accountId) {
      throw badRequest('Pass either account_id (move to that account) or internal=true (make it an account-less internal note) — not both.');
    }
    if (!toInternal && !accountId) {
      throw badRequest('reassign requires account_id (the account to move this meeting to) or internal=true (to convert it to an account-less internal note).');
    }
    return withUser(userId, async (client) => {
      const m = (await client.query('SELECT id, account_id, filename FROM meetings WHERE id = $1 AND deleted_at IS NULL', [id])).rows[0];
      if (!m) return null;
      if (!toInternal) {
        const acct = (await client.query('SELECT id FROM accounts WHERE id = $1', [accountId])).rows[0];
        if (!acct) {
          throw notFound(`Account not found: id=${accountId}.`);
        }
      }
      try {
        await client.query(
          'UPDATE meetings SET account_id = $2, internal = $3, needs_review = false WHERE id = $1',
          [id, toInternal ? null : accountId, toInternal]
        );
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw conflict(
            toInternal
              ? `You already have an internal note with the filename "${m.filename}". Rename one before converting this meeting to internal.`
              : `That account already has a meeting with the filename "${m.filename}". Rename one before moving this meeting there.`
          );
        }
        throw err;
      }
      return this._fetchFull(client, id);
    });
  }

  // Triage: link an unlinked attendee row to a contact. If the contact is
  // already an attendee on this meeting, the unlinked row is dropped (dedupe)
  // rather than creating a duplicate link.
  async linkAttendee(userId: number, meetingId: number, attendeeId: number, contactId: number) {
    return withUser(userId, async (client) => {
      const att = (await client.query(
        'SELECT id, contact_id FROM meeting_attendees WHERE id = $1 AND meeting_id = $2',
        [attendeeId, meetingId]
      )).rows[0];
      if (!att) return null;
      const contact = (await client.query('SELECT id FROM contacts WHERE id = $1', [contactId])).rows[0];
      if (!contact) {
        throw notFound(`Contact not found: id=${contactId}.`);
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

  // Create a meeting from a resolved email list. Caller is expected to have run
  // contacts.resolveEmails first. The account + contacts (+ opt-in enrichment)
  // half is delegated to ContactsService.importFromEmails; this method only
  // adds the meeting on top — so it requires meeting fields (date + body) the
  // bare import does not. For "add people, no meeting" use importFromEmails.
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
  async createFromEmails(userId: number, payload: any) {
    if (!this.contactsService) {
      throw new Error('MeetingsService.createFromEmails requires a contactsService dep');
    }
    if (!payload?.date) throw badRequest('payload.date is required (ISO date string, e.g. "2026-05-20").');
    if (!payload?.body) throw badRequest('payload.body is required (the meeting notes as markdown text).');

    // Account + contacts + opt-in enrichment is the contacts-service "import"
    // half of the from-emails flow; this method just layers a meeting on top.
    // Keeps the two paths DRY and the account/people logic in one place
    // (ContactsService.importFromEmails) — a meeting is created only because
    // there are notes to attach, never "for the sake of a meeting".
    const { account_id: accountId, contact_ids: contactIds, enrichment_jobs: enrichmentJobIds } =
      await this.contactsService.importFromEmails(userId, {
        account: payload.account,
        contacts: payload.contacts,
      });

    const meeting = await this.create(userId, accountId, {
      date: payload.date,
      starts_at: payload.starts_at || null,
      ends_at: payload.ends_at || null,
      location: payload.location || null,
      title: payload.title || null,
      attendees: payload.attendees_text || null,
      body: payload.body,
      contact_ids: contactIds,
      internal: false,
    });

    return { meeting, account_id: accountId, enrichment_jobs: enrichmentJobIds };
  }
}
