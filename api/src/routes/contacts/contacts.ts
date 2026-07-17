import type { FastifyInstance } from 'fastify';
import type { ContactsService } from '../../services/contacts/contacts.js';
import type { AccountsService } from '../../services/accounts/accounts.js';
import type { ContactEnrichmentService } from '../../services/contacts/contact-enrichment.js';
import { badRequest } from '../../lib/http-error.js';

// Shared message for the "can't research a nameless contact" guard — full_name
// is nullable by design (calendar import / the agent routinely create
// email-only contacts), so the research surfaces must reject it with a clear,
// actionable error rather than letting enqueue throw an opaque 500.
const RESEARCH_NEEDS_NAME = 'cannot research a contact without a name — set full_name first';

export default async function contactRoutes(fastify: FastifyInstance, { contactsService, accountsService, contactEnrichmentService }: { contactsService: ContactsService; accountsService: AccountsService; contactEnrichmentService: ContactEnrichmentService }) {
  // List all contacts (with optional filters)
  fastify.get<{ Querystring: { company?: string; search?: string; kind?: string; city?: string; country?: string; limit?: number; offset?: number } }>('/contacts', {
    schema: {
      description: 'List all contacts. Supports filtering by company slug, kind, and search text.',
      tags: ['contacts'],
      querystring: {
        type: 'object',
        properties: {
          company: { type: 'string', description: 'Filter by account slug' },
          search: { type: 'string', description: 'Search by name, email, company, or title' },
          kind: { type: 'string', enum: ['account', 'partner', 'internal'], description: 'Filter by contact kind' },
          city: { type: 'string', description: 'Filter by city (case-insensitive exact match)' },
          country: { type: 'string', description: 'Filter by country (case-insensitive exact match)' },
          limit: { type: 'integer', minimum: 1, description: 'Optional. Omit to return all rows.' },
          offset: { type: 'integer', default: 0 },
        },
      },
    },
  }, async (request) => {
    return contactsService.getAll(request.userId, request.query);
  });

  // List companies that have contacts (for filter dropdown)
  fastify.get('/contacts/companies', {
    schema: {
      description: 'List companies that have contacts, with counts.',
      tags: ['contacts'],
    },
  }, async (request) => {
    return contactsService.getCompanies(request.userId);
  });

  // Attendee buckets for the meeting/internal-note picker
  fastify.get<{ Querystring: { mode: string; account_id?: number } }>('/contacts/attendee-options', {
    schema: {
      description: 'List contacts grouped by bucket for the attendee picker. mode=external (requires account_id) returns {account, partner, internal} where account is the account\'s direct contacts, partner is contacts at accounts linked as partners, internal is all kind=internal contacts. mode=internal returns {partner, internal} spanning all partner/internal contacts.',
      tags: ['contacts'],
      querystring: {
        type: 'object',
        required: ['mode'],
        properties: {
          mode: { type: 'string', enum: ['external', 'internal'] },
          account_id: { type: 'integer', description: 'Required when mode=external' },
        },
      },
    },
  }, async (request, reply) => {
    const { mode, account_id } = request.query;
    if (mode === 'external' && !account_id) {
      reply.code(400);
      return { error: 'account_id is required when mode=external' };
    }
    try {
      return await contactsService.getAttendeeOptions(request.userId, { mode, accountId: account_id });
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode) { reply.code(e.statusCode); return { error: e.message }; }
      throw err;
    }
  });

  // Pre-create dedupe probe. Same match logic create() uses internally
  // (email-first, then full_name+kind). Returns the existing contact or 404 —
  // lets callers (agents, the GUI) decide between update / link / new instead
  // of letting create() throw 409.
  fastify.post<{ Body: { email?: string; full_name?: string; kind?: string } }>('/contacts/find-existing', {
    schema: {
      description: 'Read-only dedupe probe: normalized email (trimmed + lowercased, unique per user when non-null) wins, then exact (full_name + kind). No fuzzy tier (that\'s only in create/find-or-create). Returns the matched contact (with linked accounts) or 404. Use this to decide whether to create vs update vs link.',
      tags: ['contacts'],
      body: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          full_name: { type: 'string' },
          kind: { type: 'string', enum: ['account', 'partner', 'internal'], default: 'account' },
        },
      },
    },
  }, async (request, reply) => {
    const contact = await contactsService.findExisting(request.userId, request.body || {});
    if (!contact) { reply.code(404); return { error: 'No matching contact' }; }
    return contact;
  });

  // Idempotent upsert. find-existing + create combined, but with fuzzy name
  // matching: returns the matched contact (exact email → exact full_name+kind →
  // fuzzy full_name via pg_trgm) without creating, else creates. Prefer this
  // over POST /contacts when ingesting people so near-duplicates don't pile up.
  fastify.post<{ Body: { full_name?: string; company?: string; title?: string; email?: string; phone?: string; linkedin?: string; notes?: string; kind?: string; location_raw?: string; city?: string; state?: string; country?: string; account_id?: number } }>('/contacts/find-or-create', {
    schema: {
      description: 'Idempotent contact upsert — the single creation path that runs full dedupe + enrich. Email is optional, but every nonblank address is trimmed, lowercased, and unique per user. Matches an existing contact by normalized email, then exact full_name+kind, then fuzzy full_name within the same kind (pg_trgm) — returning it with matched_by (email|full_name|fuzzy) and match_score (for fuzzy); otherwise creates. On a match, any field you supply that is currently BLANK on the stored contact is filled in (enriched, never overwriting existing values) and reported via enriched/enriched_fields. Supply at least one of email or full_name — a name-only or email-only contact is valid. Optional account_id (re)links the result to an account. Concurrent submissions of the same email resolve to one row. Never throws 409 (unlike POST /contacts).',
      tags: ['contacts'],
      body: {
        type: 'object',
        properties: {
          full_name: { type: 'string' },
          company: { type: 'string' },
          title: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
          linkedin: { type: 'string' },
          notes: { type: 'string' },
          kind: { type: 'string', enum: ['account', 'partner', 'internal'], default: 'account', description: 'account = works at a non-partner account; partner = channel/reseller rep; internal = teammate at your own company' },
          location_raw: { type: 'string' },
          city: { type: 'string' },
          state: { type: 'string' },
          country: { type: 'string' },
          account_id: { type: 'integer', description: 'Optional — link the matched/created contact to this account' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { account_id, ...data } = request.body || {};
      const result = await contactsService.findOrCreate(request.userId, data, account_id);
      reply.code(result.created ? 201 : 200);
      return result;
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode) { reply.code(e.statusCode); return { error: e.message }; }
      throw err;
    }
  });

  // ── From-emails staging (account + people; NO meeting) ─────────────────
  // resolve-emails: pure read — turn a pasted attendee list into matched
  // contacts + account candidates. from-emails: materialize the account +
  // contacts WITHOUT a meeting. To also log a meeting, use the meetings
  // equivalent (POST /api/meetings/from-emails) instead.
  fastify.post<{ Body: { emails: string } }>('/contacts/resolve-emails', {
    schema: {
      description: 'Resolve a list of attendee emails into existing contacts (case-insensitive email match) and account candidates (by domain). Internal-domain emails (managed via internal-domains; env SELF_DOMAINS/INTERNAL_DOMAINS as bootstrap) are flagged kind=internal and never become account candidates. Pure read — no writes. Pair with POST /api/contacts/from-emails to create the account + contacts, or POST /api/meetings/from-emails to also log a meeting.',
      tags: ['contacts'],
      body: {
        type: 'object',
        required: ['emails'],
        properties: {
          emails: {
            type: 'string',
            description: 'Raw email list. Accepts comma/semicolon/newline separators and "Name <email>" form. The server regex-extracts each address, so leading/trailing prose ("Attendees: …") is fine.',
          },
        },
      },
    },
  }, async (request) => {
    return contactsService.resolveEmails(request.userId, request.body.emails);
  });

  // Create an account (if new) + contacts from a resolved email list — NO
  // meeting. This is the "add these people" path; only reach for the meetings
  // equivalent when you actually have notes to attach.
  fastify.post<{ Body: { account: { mode: string; account_id?: number; name?: string; domain?: string }; contacts: Array<{ mode: string; contact_id?: number; link_to_account?: boolean; full_name?: string; email?: string; kind?: string; research?: boolean }> } }>('/contacts/from-emails', {
    schema: {
      description: 'Materialize an account + contacts from a resolved email list, WITHOUT creating a meeting — the "add these people" path. Account: link an existing one (mode=existing, account_id) or create a new one (mode=new, name + optional domain). Contacts: array of {mode:existing, contact_id, link_to_account?} or {mode:new, full_name, email?, kind?, research?} — research=true enqueues background outreach + local-LLM enrichment (opt-in per contact; burns LinkedIn quota). Returns { account_id, contact_ids, enrichment_jobs }. To also log a meeting, use POST /api/meetings/from-emails instead.',
      tags: ['contacts'],
      body: {
        type: 'object',
        required: ['account', 'contacts'],
        properties: {
          account: {
            type: 'object',
            required: ['mode'],
            properties: {
              mode: { type: 'string', enum: ['existing', 'new'] },
              account_id: { type: 'integer' },
              name: { type: 'string' },
              domain: { type: 'string' },
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
                link_to_account: { type: 'boolean' },
                full_name: { type: 'string' },
                email: { type: 'string' },
                kind: { type: 'string', enum: ['account', 'partner', 'internal'] },
                research: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      return await contactsService.importFromEmails(request.userId, request.body);
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode) { reply.code(e.statusCode); return { error: e.message }; }
      throw err;
    }
  });

  // Lookup a contact by email (case-insensitive). 404 if not found — used by
  // the from-emails meeting flow to decide whether to create a new contact.
  fastify.get<{ Params: { email: string } }>('/contacts/by-email/:email', {
    schema: {
      description: 'Look up a single contact by email address (case-insensitive). Returns the contact with linked accounts, or 404 if no match.',
      tags: ['contacts'],
      params: { type: 'object', properties: { email: { type: 'string' } }, required: ['email'] },
    },
  }, async (request, reply) => {
    const contact = await contactsService.getByEmail(request.userId, decodeURIComponent(request.params.email));
    if (!contact) { reply.code(404); return { error: 'Contact not found' }; }
    return contact;
  });

  // List contacts for an account
  fastify.get<{ Params: { accountId: number } }>('/accounts/:accountId/contacts', {
    schema: {
      description: 'List all contacts for an account.',
      tags: ['contacts'],
      params: { type: 'object', properties: { accountId: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const account = await accountsService.getById(request.userId, request.params.accountId);
    if (!account) { reply.code(404); return { error: 'Account not found' }; }
    return contactsService.getByAccount(request.userId, request.params.accountId);
  });

  // Get single contact
  fastify.get<{ Params: { id: number } }>('/contacts/:id', {
    schema: {
      description: 'Get a single contact by ID. Includes `accounts` (linked accounts) and `meetings` — the meetings this contact attended, newest first, each with the contact\'s per-meeting RSVP/attendance `status` (going/declined/maybe/invited/owner, or null).',
      tags: ['contacts'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const contact = await contactsService.getById(request.userId, request.params.id);
    if (!contact) { reply.code(404); return { error: 'Contact not found' }; }
    return contact;
  });

  // Create contact (standalone)
  fastify.post<{ Body: { full_name?: string; company?: string; title?: string; email?: string; phone?: string; linkedin?: string; notes?: string; kind?: string; location_raw?: string; city?: string; state?: string; country?: string } }>('/contacts', {
    schema: {
      description: 'Create a new standalone contact (useful for kind=internal, with no account link yet — link later via POST /contacts/:id/accounts/:accountId to record which accounts a teammate supports). Email is optional; a supplied address is trimmed, lowercased, and unique per user. Runs the same dedupe core as find-or-create and returns 409 with the existing row if a match is found — prefer POST /contacts/find-or-create to upsert/enrich idempotently. Supply at least one of email or full_name.',
      tags: ['contacts'],
      body: {
        type: 'object',
        properties: {
          full_name: { type: 'string' },
          company: { type: 'string' },
          title: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
          linkedin: { type: 'string' },
          notes: { type: 'string' },
          kind: { type: 'string', enum: ['account', 'partner', 'internal'], default: 'account', description: 'account = works at a non-partner account (a company you sell to); partner = channel/reseller rep; internal = teammate at your own company' },
          location_raw: { type: 'string', description: 'Verbatim location string from source (e.g., LinkedIn "Greater Phoenix Area")' },
          city: { type: 'string', description: 'Normalized city, e.g., "Phoenix"' },
          state: { type: 'string', description: 'Normalized state/region, e.g., "AZ"' },
          country: { type: 'string', description: 'Normalized country, e.g., "USA"' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const contact = await contactsService.create(request.userId, request.body);
      reply.code(201);
      return contact;
    } catch (err) {
      const e = err as { statusCode?: number; message?: string; existing?: unknown };
      if (e.statusCode) {
        reply.code(e.statusCode);
        return { error: e.message, ...(e.existing ? { existing: e.existing } : {}) };
      }
      throw err;
    }
  });

  // Create contact under an account (creates + links)
  fastify.post<{ Params: { accountId: number }; Body: { full_name?: string; company?: string; title?: string; email?: string; phone?: string; linkedin?: string; notes?: string; kind?: string; location_raw?: string; city?: string; state?: string; country?: string } }>('/accounts/:accountId/contacts', {
    schema: {
      description: 'Create a new contact and link it to an account. Email is optional; a supplied address is trimmed, lowercased, and unique per user. Defaults kind=account; use kind=partner when creating a rep at a partner account. Runs the same dedupe core as find-or-create (409 on a match) — prefer find-or-create with account_id to upsert/enrich idempotently. Supply at least one of email or full_name.',
      tags: ['contacts'],
      params: { type: 'object', properties: { accountId: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: {
          full_name: { type: 'string', description: 'Full name of the contact' },
          company: { type: 'string', description: 'Company name' },
          title: { type: 'string', description: 'Job title' },
          email: { type: 'string', description: 'Email address' },
          phone: { type: 'string', description: 'Phone number' },
          linkedin: { type: 'string', description: 'LinkedIn profile URL' },
          notes: { type: 'string', description: 'Freeform notes about the contact' },
          kind: { type: 'string', enum: ['account', 'partner', 'internal'], default: 'account' },
          location_raw: { type: 'string', description: 'Verbatim location string from source' },
          city: { type: 'string' },
          state: { type: 'string' },
          country: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const account = await accountsService.getById(request.userId, request.params.accountId);
    if (!account) { reply.code(404); return { error: 'Account not found' }; }
    try {
      const contact = await contactsService.create(request.userId, request.body, request.params.accountId);
      reply.code(201);
      return contact;
    } catch (err) {
      const e = err as { statusCode?: number; message?: string; existing?: unknown };
      if (e.statusCode) {
        reply.code(e.statusCode);
        return { error: e.message, ...(e.existing ? { existing: e.existing } : {}) };
      }
      throw err;
    }
  });

  // Link contact to account
  fastify.post<{ Params: { id: number; accountId: number } }>('/contacts/:id/accounts/:accountId', {
    schema: {
      description: 'Link a contact to an account.',
      tags: ['contacts'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          accountId: { type: 'integer' },
        },
      },
    },
  }, async (request, reply) => {
    const contact = await contactsService.getById(request.userId, request.params.id);
    if (!contact) { reply.code(404); return { error: 'Contact not found' }; }
    const account = await accountsService.getById(request.userId, request.params.accountId);
    if (!account) { reply.code(404); return { error: 'Account not found' }; }
    return contactsService.linkAccount(request.userId, request.params.id, request.params.accountId);
  });

  // Unlink contact from account
  fastify.delete<{ Params: { id: number; accountId: number } }>('/contacts/:id/accounts/:accountId', {
    schema: {
      description: 'Unlink a contact from an account.',
      tags: ['contacts'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          accountId: { type: 'integer' },
        },
      },
    },
  }, async (request) => {
    return contactsService.unlinkAccount(request.userId, request.params.id, request.params.accountId);
  });

  // Reassign a contact's account link — link to_account_id and unlink
  // from_account_id atomically (fix a bad import).
  fastify.post<{ Params: { id: number }; Body: { to_account_id: number; from_account_id?: number } }>('/contacts/:id/reassign-account', {
    schema: {
      description: 'Atomically move a contact from one account to another: links to_account_id and unlinks from_account_id in a single step (fix a bad import). from_account_id is optional — omit it to only add the destination link. Contacts are many-to-many with accounts, so this moves only the one link named; any other account links are preserved. The destination is linked first, so a failure can\'t leave the contact orphaned or double-linked. Returns the contact with its updated accounts.',
      tags: ['contacts'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        required: ['to_account_id'],
        properties: {
          to_account_id: { type: 'integer', description: 'Destination account to link the contact to.' },
          from_account_id: { type: 'integer', description: 'Account to unlink (optional). Omit to only add the destination link.' },
        },
      },
    },
  }, async (request, reply) => {
    const { to_account_id, from_account_id } = request.body || {};
    if (!to_account_id) { reply.code(400); return { error: 'to_account_id is required' }; }
    try {
      const contact = await contactsService.reassignAccount(request.userId, request.params.id, from_account_id, to_account_id);
      if (!contact) { reply.code(404); return { error: 'Contact not found' }; }
      return contact;
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode) { reply.code(e.statusCode); return { error: e.message }; }
      throw err;
    }
  });

  // Full update
  fastify.put<{ Params: { id: number }; Body: { full_name: string; company?: string; title?: string; email?: string; phone?: string; linkedin?: string; notes?: string; kind?: string; location_raw?: string; city?: string; state?: string; country?: string } }>('/contacts/:id', {
    schema: {
      description: 'Full update of a contact. A supplied email is trimmed/lowercased and returns 409 if another contact owned by this user already has it; omit email to store no address.',
      tags: ['contacts'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        required: ['full_name'],
        properties: {
          full_name: { type: 'string' },
          company: { type: 'string' },
          title: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
          linkedin: { type: 'string' },
          notes: { type: 'string' },
          kind: { type: 'string', enum: ['account', 'partner', 'internal'] },
          location_raw: { type: 'string' },
          city: { type: 'string' },
          state: { type: 'string' },
          country: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const contact = await contactsService.update(request.userId, request.params.id, request.body);
      if (!contact) { reply.code(404); return { error: 'Contact not found' }; }
      return contact;
    } catch (err) {
      const e = err as { statusCode?: number; message?: string; existing?: unknown };
      if (e.statusCode) {
        reply.code(e.statusCode);
        return { error: e.message, ...(e.existing ? { existing: e.existing } : {}) };
      }
      throw err;
    }
  });

  // Partial update
  fastify.patch<{ Params: { id: number }; Body: { full_name?: string; company?: string; title?: string; email?: string; phone?: string; linkedin?: string; notes?: string; kind?: string; location_raw?: string; city?: string; state?: string; country?: string } }>('/contacts/:id', {
    schema: {
      description: 'Partial update of a contact. Only provided fields are changed. A supplied email is trimmed/lowercased and returns 409 if another contact owned by this user already has it.',
      tags: ['contacts'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: {
          full_name: { type: 'string' },
          company: { type: 'string' },
          title: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
          linkedin: { type: 'string' },
          notes: { type: 'string' },
          kind: { type: 'string', enum: ['account', 'partner', 'internal'] },
          location_raw: { type: 'string' },
          city: { type: 'string' },
          state: { type: 'string' },
          country: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const contact = await contactsService.patch(request.userId, request.params.id, request.body);
      if (!contact) { reply.code(404); return { error: 'Contact not found' }; }
      return contact;
    } catch (err) {
      const e = err as { statusCode?: number; message?: string; existing?: unknown };
      if (e.statusCode) {
        reply.code(e.statusCode);
        return { error: e.message, ...(e.existing ? { existing: e.existing } : {}) };
      }
      throw err;
    }
  });

  // Kick off a background research + LLM-format enrichment for an existing
  // contact. Same underlying ContactEnrichmentService as the from-emails
  // meeting flow — this route just supplies (contactId, name, accountName)
  // and the service handles outreach queue + LLM formatting + PATCH.
  fastify.post<{ Params: { id: number } }>('/contacts/:id/research', {
    schema: {
      description: 'Enqueue a background outreach + local-LLM enrichment job for an existing contact. Returns `{ jobId }` immediately; poll GET /api/contacts/enrichment-jobs/:jobId or GET /api/contacts/:id/enrichment-jobs. Uses the same ContactEnrichmentService as the from-emails meeting flow — when the job completes its fields are filled into the contact FILL-ONLY (blank columns only; curated values are never overwritten).',
      tags: ['contacts'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    if (!contactEnrichmentService) {
      reply.code(503);
      return { error: 'Contact enrichment service not available' };
    }
    const contact = await contactsService.getById(request.userId, request.params.id);
    if (!contact) { reply.code(404); return { error: 'Contact not found' }; }
    const accountName = contact.accounts?.[0]?.name || contact.company || null;
    try {
      // full_name is nullable (email-only contacts) — enqueue would throw an
      // opaque 500 on a blank name, so reject it up front with a clear 400.
      if (!contact.full_name?.trim()) throw badRequest(RESEARCH_NEEDS_NAME);
      const jobId = contactEnrichmentService.enqueue(request.userId, {
        contactId: contact.id,
        name: contact.full_name,
        accountName,
      });
      reply.code(202);
      return { jobId, contactId: contact.id, name: contact.full_name, accountName };
    } catch (err) {
      // Map any service-shaped error (statusCode) — our badRequest guard above
      // and anything enqueue might throw — instead of bubbling as a 500.
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode) { reply.code(e.statusCode); return { error: e.message }; }
      throw err;
    }
  });

  // List enrichment jobs (any status) for a single contact.
  fastify.get<{ Params: { id: number } }>('/contacts/:id/enrichment-jobs', {
    schema: {
      description: 'List contact-enrichment jobs (any status) for this contact. Newest first. Returns `{ jobs: [...] }`. Jobs are in-memory only — they evict once the cap is hit.',
      tags: ['contacts'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    if (!contactEnrichmentService) {
      reply.code(503);
      return { error: 'Contact enrichment service not available' };
    }
    const contact = await contactsService.getById(request.userId, request.params.id);
    if (!contact) { reply.code(404); return { error: 'Contact not found' }; }
    return { jobs: contactEnrichmentService.listJobsForContacts([contact.id]) };
  });

  // Poll a single contact-enrichment job by id.
  fastify.get<{ Params: { jobId: string } }>('/contacts/enrichment-jobs/:jobId', {
    schema: {
      description: 'Get the state of a contact enrichment job. Status progresses queued → running → completed | failed; while running the `stage` field tells you which phase (researching | formatting | patching). On completion, `patched` contains the fields written to the contact. Same in-memory store as /api/meetings/enrichment-jobs/:jobId.',
      tags: ['contacts'],
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

  // Delete
  fastify.delete<{ Params: { id: number } }>('/contacts/:id', {
    schema: {
      description: 'Delete a contact.',
      tags: ['contacts'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const deleted = await contactsService.delete(request.userId, request.params.id);
    if (!deleted) { reply.code(404); return { error: 'Contact not found' }; }
    return { deleted: true, full_name: deleted.full_name };
  });
}
