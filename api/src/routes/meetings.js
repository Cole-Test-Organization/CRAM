export default async function meetingRoutes(fastify, { meetingsService, accountsService, contactEnrichmentService }) {
  // List all meetings across all accounts (including internal meetings).
  fastify.get('/meetings', {
    schema: {
      description: 'List all meetings across all accounts, sorted by date descending. Includes internal meetings (internal=true). Pass internal=true/false to filter.',
      tags: ['meetings'],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', default: 50 },
          offset: { type: 'integer', default: 0 },
          internal: { type: 'boolean', description: 'Filter by internal flag. Omit to include both.' },
        },
      },
    },
  }, async (request) => {
    const { limit, offset, internal } = request.query;
    return meetingsService.getAll(request.userId, { limit, offset, internal });
  });

  // List meetings for an account
  fastify.get('/accounts/:accountId/meetings', {
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
  fastify.get('/meetings/:id', {
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
  fastify.post('/meetings', {
    schema: {
      description: 'Create a meeting note. Pass account_id for an account or partner meeting; pass internal=true (and omit account_id) for an internal-only note. contact_ids is required for non-internal meetings.',
      tags: ['meetings'],
      body: {
        type: 'object',
        required: ['date', 'body'],
        properties: {
          account_id: { type: 'integer', description: 'Account this meeting is tied to. Omit when internal=true.' },
          internal: { type: 'boolean', default: false, description: 'true for internal-only notes (no account). Default false.' },
          date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Meeting date (YYYY-MM-DD)' },
          title: { type: 'string', description: 'Brief title slug (e.g., "prisma-access-demo")' },
          attendees: { type: 'string', description: 'Optional plain-text attendees for display. contact_ids is the authoritative link.' },
          contact_ids: { type: 'array', items: { type: 'integer' }, description: 'Array of contact IDs who attended. Required for non-internal meetings.' },
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
        internal ? null : account_id,
        { ...data, internal: !!internal }
      );
      reply.code(201);
      return meeting;
    } catch (err) {
      if (err.statusCode === 400) {
        reply.code(400);
        return { error: err.message };
      }
      if (err.code === '23505') {
        reply.code(409);
        return { error: 'A meeting with this filename already exists' };
      }
      throw err;
    }
  });

  // Update meeting
  fastify.put('/meetings/:id', {
    schema: {
      description: 'Update a meeting note. If contact_ids is provided, it fully replaces the attendee links. The internal flag and account_id cannot be changed after creation.',
      tags: ['meetings'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: {
          date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          title: { type: 'string' },
          attendees: { type: 'string' },
          contact_ids: { type: 'array', items: { type: 'integer' }, description: 'Replace attendee links with these contact IDs' },
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
      if (err.statusCode === 400) {
        reply.code(400);
        return { error: err.message };
      }
      throw err;
    }
  });

  // Resolve a list of emails into known contacts and account candidates.
  // Pure read — no side effects. Step 1 of the from-emails meeting flow.
  fastify.post('/meetings/resolve-emails', {
    schema: {
      description: 'Resolve a list of attendee emails into existing contacts (by case-insensitive email match) and account candidates (by domain match). Self-domains (env: SELF_DOMAINS) are flagged kind=internal. Pure read — no writes. Pair with POST /api/meetings/from-emails to persist the user\'s choices.',
      tags: ['meetings'],
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
    return meetingsService.resolveEmails(request.userId, request.body.emails);
  });

  // Create a meeting from a resolved email list. Caller picks which account
  // candidate is the primary and which new contacts to create / research.
  fastify.post('/meetings/from-emails', {
    schema: {
      description: 'Create a non-internal meeting from a resolved email list. Account: either link to an existing one (mode=existing, account_id) or create a new one (mode=new, name + optional domain). Contacts: array of {mode:existing, contact_id} or {mode:new, full_name, email?, kind?, research?} — research=true kicks off a background outreach + local-LLM contact enrichment job (results PATCHed into the contact when ready). Account-level research is not yet implemented.',
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
      if (err.statusCode) { reply.code(err.statusCode); return { error: err.message }; }
      throw err;
    }
  });

  // List all contact-enrichment jobs whose contactId appears on this meeting's
  // attendee list. Used by the meeting view to render a live progress panel
  // for attendees the user opted into research for.
  fastify.get('/meetings/:id/enrichment-jobs', {
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
    const contactIds = (meeting.contacts || []).map((c) => Number(c.id));
    return { jobs: contactEnrichmentService.listJobsForContacts(contactIds) };
  });

  // Poll a single contact-enrichment job by id (returned in enrichment_jobs[]).
  fastify.get('/meetings/enrichment-jobs/:jobId', {
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
  fastify.delete('/meetings/:id', {
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
