import type { FastifyInstance } from 'fastify';
import type { MeetingsService } from '../../services/meetings/meetings.js';
import type { AccountsService } from '../../services/accounts/accounts.js';
import type { ContactEnrichmentService } from '../../services/contacts/contact-enrichment.js';

export default async function meetingRoutes(fastify: FastifyInstance, { meetingsService, accountsService, contactEnrichmentService }: { meetingsService: MeetingsService; accountsService: AccountsService; contactEnrichmentService: ContactEnrichmentService }) {
  // List all meetings across all accounts (including internal meetings).
  fastify.get<{ Querystring: { limit?: number; offset?: number; internal?: boolean; needs_review?: boolean } }>('/meetings', {
    schema: {
      description: 'List all meetings across all accounts, sorted by date descending. Includes internal meetings (internal=true). Pass internal=true/false to filter. Pass needs_review=true to list only parked notes awaiting triage (account-less and/or imported notes flagged for review).',
      tags: ['meetings'],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', default: 50 },
          offset: { type: 'integer', default: 0 },
          internal: { type: 'boolean', description: 'Filter by internal flag. Omit to include both.' },
          needs_review: { type: 'boolean', description: 'Filter by the review flag. true = only notes parked for triage; false = only settled notes; omit for both.' },
        },
      },
    },
  }, async (request) => {
    const { limit, offset, internal, needs_review } = request.query;
    return meetingsService.getAll(request.userId, { limit, offset, internal, needs_review });
  });

  // List meetings for an account
  fastify.get<{ Params: { accountId: number } }>('/accounts/:accountId/meetings', {
    schema: {
      description: 'List all meetings for an account, sorted by date descending. Internal meetings (no account) are excluded.',
      tags: ['meetings'],
      params: { type: 'object', properties: { accountId: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const account = await accountsService.getById(request.userId, request.params.accountId);
    if (!account) { reply.code(404); return { error: 'Account not found' }; }
    return meetingsService.getByAccount(request.userId, request.params.accountId);
  });

  // Get single meeting
  fastify.get<{ Params: { id: number } }>('/meetings/:id', {
    schema: {
      description: 'Get a single meeting with full body. Use after finding a meeting via search or account detail.',
      tags: ['meetings'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const meeting = await meetingsService.getById(request.userId, request.params.id);
    if (!meeting) { reply.code(404); return { error: 'Meeting not found' }; }
    return meeting;
  });

  // Create meeting (unified — external or internal).
  fastify.post<{ Body: { account_id?: number; internal?: boolean; needs_review?: boolean; date: string; starts_at?: string | null; ends_at?: string | null; location?: string | null; title?: string; attendees?: string; unlinked_attendees?: { display_name?: string; email?: string }[]; contact_ids?: number[]; body: string } }>('/meetings', {
    schema: {
      description: 'Create a meeting note. Pass account_id for an account or partner meeting; pass internal=true (and omit account_id) for an internal-only note. contact_ids is required for non-internal meetings. Attendees come in two forms: contact_ids links existing contacts; attendees (free text) and/or unlinked_attendees record people who are NOT yet CRM contacts as unlinked attendee rows (visible on the meeting, linkable later via the link-attendee endpoint) — names already covered by a linked contact are skipped.',
      tags: ['meetings'],
      body: {
        type: 'object',
        required: ['date', 'body'],
        properties: {
          account_id: { type: 'integer', description: 'Account this meeting is tied to. Omit when internal=true.' },
          internal: { type: 'boolean', default: false, description: 'true for internal-only notes (no account). Default false.' },
          needs_review: { type: 'boolean', default: false, description: 'Park this note for triage. Set true for imported/uncertain notes you could not confidently assign; surfaced by GET /api/meetings?needs_review=true and cleared by the assign-account endpoint.' },
          date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Meeting date (YYYY-MM-DD)' },
          starts_at: { type: ['string', 'null'], format: 'date-time', description: 'Optional precise start as an ISO 8601 timestamp (e.g. "2026-05-31T13:30:00Z"). Powers the GUI Today timeline and time-of-day ordering; the calendar import sets it from the event start. Distinct from `date` (the calendar day). null/omit = no start time.' },
          ends_at: { type: ['string', 'null'], format: 'date-time', description: 'Optional precise end as an ISO 8601 timestamp. Companion to starts_at; used to detect the meeting happening right now. null/omit = no end time.' },
          location: { type: ['string', 'null'], description: 'Optional location — for a virtual meeting the conferencing URL (Google Meet / Zoom / Teams), which the Today timeline renders as a one-click "Join" button; for in-person, a room or address. The calendar import sets it from the event location.' },
          title: { type: 'string', description: 'Brief title slug (e.g., "prisma-access-demo")' },
          attendees: { type: 'string', description: 'Free-text attendees (comma/semicolon separated). Each name with no matching linked contact is stored as an unlinked attendee row — not just display text. contact_ids remains the authoritative link for known contacts.' },
          unlinked_attendees: { type: 'array', items: { type: 'object', properties: { display_name: { type: 'string' }, email: { type: 'string' } } }, description: 'Structured attendees with no CRM contact yet: [{display_name, email?}]. Recorded for visibility and one-click linking later. Alternative to the free-text attendees string.' },
          contact_ids: { type: 'array', items: { type: 'integer' }, description: 'Array of contact IDs who attended (linked attendees). Required for non-internal meetings.' },
          body: { type: 'string', description: 'Markdown content of the meeting notes' },
        },
      },
    },
  }, async (request, reply) => {
    const { account_id, internal, ...data } = request.body;
    if (!internal) {
      if (!account_id) { reply.code(400); return { error: 'account_id is required unless internal=true' }; }
      if (!data.contact_ids || data.contact_ids.length === 0) {
        reply.code(400);
        return { error: 'contact_ids is required for non-internal meetings' };
      }
      const account = await accountsService.getById(request.userId, account_id);
      if (!account) { reply.code(404); return { error: 'Account not found' }; }
    }
    try {
      const meeting = await meetingsService.create(
        request.userId,
        internal ? null : account_id!,
        { ...data, internal: !!internal }
      );
      reply.code(201);
      return meeting;
    } catch (err) {
      const e = err as { statusCode?: number; code?: string; message?: string };
      if (e.statusCode === 400) {
        reply.code(400);
        return { error: e.message };
      }
      if (e.code === '23505') {
        reply.code(409);
        return { error: 'A meeting with this filename already exists' };
      }
      throw err;
    }
  });

  // Update meeting
  fastify.put<{ Params: { id: number }; Body: { date?: string; starts_at?: string | null; ends_at?: string | null; location?: string | null; title?: string; needs_review?: boolean; attendees?: string; unlinked_attendees?: { display_name?: string; email?: string }[]; contact_ids?: number[]; body?: string } }>('/meetings/:id', {
    schema: {
      description: 'Update a meeting note. Linked and unlinked attendees are managed independently: contact_ids (when provided) fully replaces the LINKED set; attendees text and/or unlinked_attendees (when provided) fully replaces the UNLINKED set. Passing one does not disturb the other. The internal flag and account_id cannot be changed after creation — use the assign-account endpoint to attach a parked note to an account.',
      tags: ['meetings'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: {
          date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          starts_at: { type: ['string', 'null'], format: 'date-time', description: 'Precise start as an ISO 8601 timestamp. Omit to leave unchanged; null clears it.' },
          ends_at: { type: ['string', 'null'], format: 'date-time', description: 'Precise end as an ISO 8601 timestamp. Omit to leave unchanged; null clears it.' },
          location: { type: ['string', 'null'], description: 'Location / conferencing URL. Omit to leave unchanged; null clears it.' },
          title: { type: 'string' },
          needs_review: { type: 'boolean', description: 'Set/clear the triage flag.' },
          attendees: { type: 'string', description: 'Free-text attendees (comma/semicolon separated). When present, replaces the unlinked attendee rows (names already covered by a linked contact are skipped).' },
          unlinked_attendees: { type: 'array', items: { type: 'object', properties: { display_name: { type: 'string' }, email: { type: 'string' } } }, description: 'Structured unlinked attendees [{display_name, email?}]. When present, replaces the unlinked attendee set.' },
          contact_ids: { type: 'array', items: { type: 'integer' }, description: 'Replace the LINKED attendee set with these contact IDs.' },
          body: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const meeting = await meetingsService.update(request.userId, request.params.id, request.body);
      if (!meeting) { reply.code(404); return { error: 'Meeting not found' }; }
      return meeting;
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode === 400) {
        reply.code(400);
        return { error: e.message };
      }
      throw err;
    }
  });

  // Triage: attach a parked (account-less) note to an account. The one path
  // allowed to set account_id after creation — flips internal→false and clears
  // needs_review. 409 if the meeting is already assigned to an account.
  fastify.post<{ Params: { id: number }; Body: { account_id: number } }>('/meetings/:id/assign-account', {
    schema: {
      description: 'Assign a parked, account-less note to an account (triage). Sets account_id, flips internal=false, and clears needs_review. Only applies to currently-unassigned meetings — returns 409 if the meeting is already linked to an account. Pair with GET /api/meetings?needs_review=true to find parked notes, and POST /api/accounts/find-or-create to pick the target account.',
      tags: ['meetings'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        required: ['account_id'],
        properties: {
          account_id: { type: 'integer', description: 'The account to attach this note to.' },
        },
      },
    },
  }, async (request, reply) => {
    const { account_id } = request.body || {};
    if (!account_id) { reply.code(400); return { error: 'account_id is required' }; }
    try {
      const meeting = await meetingsService.assignAccount(request.userId, request.params.id, account_id);
      if (!meeting) { reply.code(404); return { error: 'Meeting not found' }; }
      return meeting;
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode) { reply.code(e.statusCode); return { error: e.message }; }
      throw err;
    }
  });

  // Reassign a meeting to a DIFFERENT account, or convert it to an internal
  // note (fix a bad import). Unlike assign-account, this works on a meeting that
  // already has an account.
  fastify.post<{ Params: { id: number }; Body: { account_id?: number; internal?: boolean } }>('/meetings/:id/reassign-account', {
    schema: {
      description: 'Move a meeting to a different account, or convert it to an internal note (fix a bad import). Unlike POST /meetings/:id/assign-account (triage — account-less notes only, 409 if already assigned), this works on a meeting that ALREADY has an account. Pass account_id to move it to that account (sets internal=false); pass internal=true (and omit account_id) to strip the account and make it an account-less internal note. Clears needs_review either way. Attendees are left untouched. Returns 409 if the destination already has a meeting with the same filename.',
      tags: ['meetings'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: {
          account_id: { type: 'integer', description: 'Destination account to move this meeting to. Mutually exclusive with internal=true.' },
          internal: { type: 'boolean', description: 'Set true (and omit account_id) to convert the meeting to an account-less internal note.' },
        },
      },
    },
  }, async (request, reply) => {
    const { account_id, internal } = request.body || {};
    if (!account_id && !internal) {
      reply.code(400);
      return { error: 'Provide account_id (move to that account) or internal=true (make it an account-less internal note).' };
    }
    try {
      const meeting = await meetingsService.reassignAccount(request.userId, request.params.id, { accountId: account_id, internal: !!internal });
      if (!meeting) { reply.code(404); return { error: 'Meeting not found' }; }
      return meeting;
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode) { reply.code(e.statusCode); return { error: e.message }; }
      throw err;
    }
  });

  // Triage: link an unlinked attendee row to an existing contact. If that
  // contact is already an attendee on the meeting, the unlinked row is dropped
  // (dedupe) rather than creating a duplicate link.
  fastify.post<{ Params: { id: number; attendeeId: number }; Body: { contact_id: number } }>('/meetings/:id/attendees/:attendeeId/link', {
    schema: {
      description: 'Link an unlinked attendee (a name with no CRM contact) to an existing contact (triage). Converts the unlinked attendee row into a linked one; if the contact is already an attendee on this meeting, the unlinked row is dropped instead (dedupe). attendeeId is the attendee_id from the meeting\'s unlinked_attendees[]. Resolve the contact first via the contacts tool (or contacts find-or-create).',
      tags: ['meetings'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          attendeeId: { type: 'integer' },
        },
      },
      body: {
        type: 'object',
        required: ['contact_id'],
        properties: {
          contact_id: { type: 'integer', description: 'The existing contact to link this attendee to.' },
        },
      },
    },
  }, async (request, reply) => {
    const { contact_id } = request.body || {};
    if (!contact_id) { reply.code(400); return { error: 'contact_id is required' }; }
    try {
      const meeting = await meetingsService.linkAttendee(request.userId, request.params.id, request.params.attendeeId, contact_id);
      if (!meeting) { reply.code(404); return { error: 'Attendee not found on this meeting' }; }
      return meeting;
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode) { reply.code(e.statusCode); return { error: e.message }; }
      throw err;
    }
  });

  // Create a meeting from a resolved email list. Caller picks which account
  // candidate is the primary and which new contacts to create / research.
  fastify.post<{ Body: { date: string; title?: string; attendees_text?: string; body: string; account: { mode: string; account_id?: number; name?: string; domain?: string }; contacts: { mode: string; contact_id?: number; link_to_account?: boolean; full_name?: string; email?: string; kind?: string; research?: boolean }[] } }>('/meetings/from-emails', {
    schema: {
      description: 'Create a non-internal meeting from a resolved email list — AND its account + contacts — in one call. Use this only when you have actual meeting notes (a body); to just add the account + people with no meeting, use POST /api/contacts/from-emails instead. The account + contacts half is delegated to that same import path. Account: link an existing one (mode=existing, account_id) or create a new one (mode=new, name + optional domain). Contacts: array of {mode:existing, contact_id, link_to_account?} or {mode:new, full_name, email?, kind?, research?} — research=true kicks off a background outreach + local-LLM contact enrichment job (results PATCHed into the contact when ready). Account-level research is not yet implemented.',
      tags: ['meetings'],
      body: {
        type: 'object',
        required: ['date', 'body', 'account', 'contacts'],
        properties: {
          date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          title: { type: 'string' },
          attendees_text: { type: 'string', description: 'Optional display-only attendees label.' },
          body: { type: 'string' },
          account: {
            type: 'object',
            required: ['mode'],
            properties: {
              mode: { type: 'string', enum: ['existing', 'new'] },
              account_id: { type: 'integer' },
              name: { type: 'string' },
              domain: { type: 'string', description: 'When provided, added to the account.domains array. For mode=new this is also used as the canonical domain.' },
            },
          },
          contacts: {
            type: 'array',
            items: {
              type: 'object',
              required: ['mode'],
              properties: {
                mode: { type: 'string', enum: ['existing', 'new'] },
                contact_id: { type: 'integer' },
                link_to_account: { type: 'boolean', description: 'For mode=existing: also link this contact to the chosen account (idempotent).' },
                full_name: { type: 'string' },
                email: { type: 'string' },
                kind: { type: 'string', enum: ['account', 'partner', 'internal'], default: 'account' },
                research: { type: 'boolean', description: 'For mode=new: enqueue background outreach + LLM enrichment after the meeting is saved.' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const result = await meetingsService.createFromEmails(request.userId, request.body);
      reply.code(201);
      return result;
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode) { reply.code(e.statusCode); return { error: e.message }; }
      throw err;
    }
  });

  // List all contact-enrichment jobs whose contactId appears on this meeting's
  // attendee list. Used by the meeting view to render a live progress panel
  // for attendees the user opted into research for.
  fastify.get<{ Params: { id: number } }>('/meetings/:id/enrichment-jobs', {
    schema: {
      description: 'List contact-enrichment jobs (any status) for the contacts attached to this meeting. Newest first. Returns `{ jobs: [...] }`. Useful for surfacing background research progress on the meeting view. Jobs are in-memory only — old ones evict once the cap is hit.',
      tags: ['meetings'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    if (!contactEnrichmentService) {
      reply.code(503);
      return { error: 'Contact enrichment service not available' };
    }
    const meeting = await meetingsService.getById(request.userId, request.params.id);
    if (!meeting) { reply.code(404); return { error: 'Meeting not found' }; }
    const contactIds = (meeting.contacts || []).map((c: any) => Number(c.id));
    return { jobs: contactEnrichmentService.listJobsForContacts(contactIds) };
  });

  // Poll a single contact-enrichment job by id (returned in enrichment_jobs[]).
  fastify.get<{ Params: { jobId: string } }>('/meetings/enrichment-jobs/:jobId', {
    schema: {
      description: 'Get the state of a contact enrichment job kicked off by POST /api/meetings/from-emails. Status progresses queued → running → completed | failed; while running the `stage` field tells you which phase (researching | formatting | patching) the job is in. On completion, `patched` contains the fields written to the contact.',
      tags: ['meetings'],
      params: {
        type: 'object',
        required: ['jobId'],
        properties: { jobId: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    if (!contactEnrichmentService) {
      reply.code(503);
      return { error: 'Contact enrichment service not available' };
    }
    const job = contactEnrichmentService.getJob(request.params.jobId);
    if (!job) { reply.code(404); return { error: `Enrichment job not found: ${request.params.jobId}` }; }
    return job;
  });

  // Delete meeting
  fastify.delete<{ Params: { id: number } }>('/meetings/:id', {
    schema: {
      description: 'Delete a meeting note.',
      tags: ['meetings'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const deleted = await meetingsService.delete(request.userId, request.params.id);
    if (!deleted) { reply.code(404); return { error: 'Meeting not found' }; }
    return { deleted: true, filename: deleted.filename };
  });
}
