export default async function contactRoutes(fastify, { contactsService, accountsService, contactEnrichmentService }) {
  // List all contacts (with optional filters)
  fastify.get('/contacts', {
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
          limit: { type: 'integer', default: 200 },
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
  fastify.get('/contacts/attendee-options', {
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
      if (err.statusCode) { reply.code(err.statusCode); return { error: err.message }; }
      throw err;
    }
  });

  // Pre-create dedupe probe. Same match logic create() uses internally
  // (email-first, then full_name+kind). Returns the existing contact or 404 —
  // lets callers (agents, the GUI) decide between update / link / new instead
  // of letting create() throw 409.
  fastify.post('/contacts/find-existing', {
    schema: {
      description: 'Look up a contact using the same dedupe rules POST /contacts applies before insert: case-insensitive email match wins; falls back to (full_name + kind). Returns the matched contact (with linked accounts) or 404. Use this to decide whether to create vs update vs link.',
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

  // Lookup a contact by email (case-insensitive). 404 if not found — used by
  // the from-emails meeting flow to decide whether to create a new contact.
  fastify.get('/contacts/by-email/:email', {
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
  fastify.get('/accounts/:accountId/contacts', {
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
  fastify.get('/contacts/:id', {
    schema: {
      description: 'Get a single contact by ID (includes linked accounts).',
      tags: ['contacts'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const contact = await contactsService.getById(request.userId, request.params.id);
    if (!contact) { reply.code(404); return { error: 'Contact not found' }; }
    return contact;
  });

  // Create contact (standalone)
  fastify.post('/contacts', {
    schema: {
      description: 'Create a new standalone contact. Useful for kind=internal (no account linkage).',
      tags: ['contacts'],
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
      if (err.statusCode) {
        reply.code(err.statusCode);
        return { error: err.message, ...(err.existing ? { existing: err.existing } : {}) };
      }
      throw err;
    }
  });

  // Create contact under an account (creates + links)
  fastify.post('/accounts/:accountId/contacts', {
    schema: {
      description: 'Create a new contact and link it to an account. Defaults kind=account; use kind=partner when creating a rep at a partner account.',
      tags: ['contacts'],
      params: { type: 'object', properties: { accountId: { type: 'integer' } } },
      body: {
        type: 'object',
        required: ['full_name'],
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
      if (err.statusCode) {
        reply.code(err.statusCode);
        return { error: err.message, ...(err.existing ? { existing: err.existing } : {}) };
      }
      throw err;
    }
  });

  // Link contact to account
  fastify.post('/contacts/:id/accounts/:accountId', {
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
  fastify.delete('/contacts/:id/accounts/:accountId', {
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

  // Full update
  fastify.put('/contacts/:id', {
    schema: {
      description: 'Full update of a contact.',
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
      if (err.statusCode) {
        reply.code(err.statusCode);
        return { error: err.message, ...(err.existing ? { existing: err.existing } : {}) };
      }
      throw err;
    }
  });

  // Partial update
  fastify.patch('/contacts/:id', {
    schema: {
      description: 'Partial update of a contact. Only provided fields are changed.',
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
      if (err.statusCode) {
        reply.code(err.statusCode);
        return { error: err.message, ...(err.existing ? { existing: err.existing } : {}) };
      }
      throw err;
    }
  });

  // Kick off a background research + LLM-format enrichment for an existing
  // contact. Same underlying ContactEnrichmentService as the from-emails
  // meeting flow — this route just supplies (contactId, name, accountName)
  // and the service handles outreach queue + LLM formatting + PATCH.
  fastify.post('/contacts/:id/research', {
    schema: {
      description: 'Enqueue a background outreach + local-LLM enrichment job for an existing contact. Returns `{ jobId }` immediately; poll GET /api/contacts/enrichment-jobs/:jobId or GET /api/contacts/:id/enrichment-jobs. Uses the same ContactEnrichmentService as the from-emails meeting flow — when the job completes the contact is PATCHed in place.',
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
    const jobId = contactEnrichmentService.enqueue(request.userId, {
      contactId: contact.id,
      name: contact.full_name,
      accountName,
    });
    reply.code(202);
    return { jobId, contactId: contact.id, name: contact.full_name, accountName };
  });

  // List enrichment jobs (any status) for a single contact.
  fastify.get('/contacts/:id/enrichment-jobs', {
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
  fastify.get('/contacts/enrichment-jobs/:jobId', {
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
  fastify.delete('/contacts/:id', {
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
