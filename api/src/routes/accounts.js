// TODO: Add authentication for production/remote access

export default async function accountRoutes(fastify, { accountsService }) {
  // List all accounts
  fastify.get('/accounts', {
    schema: {
      description: 'List accounts. Status is binary: "account" (companies you sell to) or "partner" (channel partners you sell with). Pass status=partner to get just partners, exclude_status=partner to get all non-partner accounts.',
      tags: ['accounts'],
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter to rows whose status matches (case-insensitive). Use "account" or "partner".' },
          exclude_status: { type: 'string', description: 'Filter out rows whose status matches (case-insensitive). Typically "partner" to list non-partner accounts.' },
          sort: { type: 'string', enum: ['name', 'slug', 'status', 'last_contact', 'created_at', 'updated_at'], default: 'name' },
          order: { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
          limit: { type: 'integer', minimum: 1, description: 'Optional. Omit to return all rows.' },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request) => {
    return accountsService.getAll(request.userId, request.query);
  });

  // Lightweight slug list (for agents) — returns just slugs to avoid blowing up
  // small context windows. Use /accounts/by-slug/:slug for full details.
  fastify.get('/accounts/slugs', {
    schema: {
      description: 'List all account slugs (just the slugs, nothing else). Lightweight discovery endpoint for agents — use /accounts/by-slug/:slug to drill into any specific account.',
      tags: ['accounts'],
      response: {
        200: {
          type: 'object',
          properties: {
            slugs: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  }, async (request) => {
    return { slugs: await accountsService.getAllSlugs(request.userId) };
  });

  // Search accounts by name (backward-compatible fuzzy search for agents)
  fastify.get('/accounts/search', {
    schema: {
      description: 'Fuzzy search for accounts by name. Use when you know part of a company name but not the exact slug.',
      tags: ['accounts'],
      querystring: {
        type: 'object',
        required: ['q'],
        properties: {
          q: { type: 'string', description: 'Search query' },
          limit: { type: 'integer', default: 5, minimum: 1, maximum: 20 },
        },
      },
    },
  }, async (request) => {
    const { q, limit } = request.query;
    const results = await fastify.searchService.searchAccounts(request.userId, q, { limit });
    return { results };
  });

  // Pre-create dedupe probe. Same match logic create() uses internally
  // (slug → domain → case-insensitive name). Returns the existing account or
  // 404 — lets callers (agents, the GUI) avoid the 409 thrown by create().
  fastify.post('/accounts/find-existing', {
    schema: {
      description: 'Look up an account using the same dedupe rules POST /accounts applies before insert: slug match wins; falls back to any matching entry in the domains array; final fallback is a case-insensitive name match. Returns the matched account (with full children) or 404. Use this to decide whether to create vs update.',
      tags: ['accounts'],
      body: {
        type: 'object',
        properties: {
          slug: { type: 'string' },
          name: { type: 'string' },
          domains: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  }, async (request, reply) => {
    const account = await accountsService.findExisting(request.userId, request.body || {});
    if (!account) { reply.code(404); return { error: 'No matching account' }; }
    return account;
  });

  // Get account by slug (convenience for agents)
  fastify.get('/accounts/by-slug/:slug', {
    schema: {
      description: 'Get complete account details by slug. Slugs are lowercase-hyphenated alphanumeric (e.g. "acme-manufacturing"). If you only have a company name, use /api/accounts/search?q=... instead — slug lookups require the exact slug, not the display name.',
      tags: ['accounts'],
      params: {
        type: 'object',
        properties: { slug: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    try {
      const account = await accountsService.getBySlug(request.userId, request.params.slug);
      if (!account) {
        reply.code(404);
        return { error: `No account with slug "${request.params.slug}". Try /api/accounts/search?q=... to fuzzy-match by name — slugs are exact.` };
      }
      return account;
    } catch (err) {
      if (err.statusCode) { reply.code(err.statusCode); return { error: err.message }; }
      throw err;
    }
  });

  // Get account by domain (agent convenience — e.g., from an email like jane@acme.com)
  fastify.get('/accounts/by-domain/:domain', {
    schema: {
      description: 'Get complete account details by an associated domain. Pass a real domain like "acme.com" — must contain "." (case-insensitive, www./protocol/path stripped). If you only have a company name, use /api/search?type=accounts; if you have the URL slug, use /accounts/by-slug/:slug.',
      tags: ['accounts'],
      params: {
        type: 'object',
        properties: { domain: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    try {
      const account = await accountsService.getByDomain(request.userId, request.params.domain);
      if (!account) {
        reply.code(404);
        return { error: `No account found for domain "${request.params.domain}"` };
      }
      return account;
    } catch (err) {
      if (err.statusCode) { reply.code(err.statusCode); return { error: err.message }; }
      throw err;
    }
  });

  // Get account by ID
  fastify.get('/accounts/:id', {
    schema: {
      description: 'Get complete account details by ID. Includes contacts and meeting list.',
      tags: ['accounts'],
      params: {
        type: 'object',
        properties: { id: { type: 'integer' } },
      },
    },
  }, async (request, reply) => {
    const account = await accountsService.getById(request.userId, request.params.id);
    if (!account) {
      reply.code(404);
      return { error: 'Account not found' };
    }
    return account;
  });

  // Create account
  fastify.post('/accounts', {
    schema: {
      description: 'Create a new account. Slug must be lowercase with hyphens (e.g., "acme-corp").',
      tags: ['accounts'],
      body: {
        type: 'object',
        required: ['slug', 'name'],
        properties: {
          slug: { type: 'string', pattern: '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$', description: 'URL-safe identifier' },
          name: { type: 'string', description: 'Display name of the company' },
          status: { type: 'string', description: 'Either "account" (default — companies you sell to) or "partner" (channel partners you sell with).' },
          last_contact: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Last contact date (YYYY-MM-DD)' },
          relationship_summary: { type: 'string', description: 'Summary of the relationship' },
          open_threads: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, done: { type: 'boolean', default: false } } }, description: 'Open action items and follow-ups' },
          active_deals: { type: 'string', description: 'Active deals markdown (for partner accounts)' },
          domains: { type: 'array', items: { type: 'string' }, description: 'List of domains associated with this account (e.g., ["acme.com", "acme-ventures.com"]). Normalized to lowercase; protocol and www. stripped. Used for lookup when only an email/domain is known.' },
          favorite: { type: 'boolean', description: 'Per-user favorite flag — pinned rows sort to the top of /api/accounts listings.' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const account = await accountsService.create(request.userId, request.body);
      reply.code(201);
      return account;
    } catch (err) {
      if (err.statusCode) {
        reply.code(err.statusCode);
        return { error: err.message, ...(err.existing ? { existing: err.existing } : {}) };
      }
      if (err.code === '23505') {
        reply.code(409);
        return { error: `Account with slug "${request.body.slug}" already exists` };
      }
      throw err;
    }
  });

  // Full update
  fastify.put('/accounts/:id', {
    schema: {
      description: 'Full replacement of an account. All fields must be provided.',
      tags: ['accounts'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        required: ['slug', 'name'],
        properties: {
          slug: { type: 'string', pattern: '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' },
          name: { type: 'string' },
          status: { type: 'string' },
          last_contact: { type: 'string' },
          relationship_summary: { type: 'string' },
          open_threads: { type: 'array', items: { type: 'object' } },
          active_deals: { type: 'string' },
          domains: { type: 'array', items: { type: 'string' } },
          favorite: { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    const account = await accountsService.update(request.userId, request.params.id, request.body);
    if (!account) {
      reply.code(404);
      return { error: 'Account not found' };
    }
    return account;
  });

  // Partial update (merge)
  fastify.patch('/accounts/:id', {
    schema: {
      description: 'Partial update. Only provided fields are updated. Open threads and domains are fully replaced. Technical environment (firewalls, EDRs, employee count, …) lives on the separate /accounts/:id/details endpoint — do not pass it here. Manage partners via /accounts/:id/partners and internal team via contacts with kind=internal.',
      tags: ['accounts'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: {
          slug: { type: 'string', pattern: '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' },
          name: { type: 'string' },
          status: { type: 'string' },
          last_contact: { type: 'string' },
          relationship_summary: { type: 'string' },
          open_threads: { type: 'array', items: { type: 'object' } },
          active_deals: { type: 'string' },
          domains: { type: 'array', items: { type: 'string' }, description: 'Full replace on PATCH. Send the complete list of domains.' },
          favorite: { type: 'boolean', description: 'Per-user favorite flag — pinned rows sort to the top of /api/accounts listings.' },
        },
      },
    },
  }, async (request, reply) => {
    const account = await accountsService.patch(request.userId, request.params.id, request.body);
    if (!account) {
      reply.code(404);
      return { error: 'Account not found' };
    }
    return account;
  });

  // List partner accounts linked to a given (non-partner) account
  fastify.get('/accounts/:id/partners', {
    schema: {
      description: 'List partner accounts linked to this account.',
      tags: ['accounts'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const account = await accountsService.getById(request.userId, request.params.id);
    if (!account) { reply.code(404); return { error: 'Account not found' }; }
    return accountsService.listPartners(request.userId, request.params.id);
  });

  // Add a partner link (account → partner)
  fastify.post('/accounts/:id/partners/:partnerId', {
    schema: {
      description: 'Link a partner account to this account. Creates a channel partnership so the partner\'s contacts appear as attendee options on this account\'s meetings.',
      tags: ['accounts'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          partnerId: { type: 'integer' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      return await accountsService.addPartner(request.userId, request.params.id, request.params.partnerId);
    } catch (err) {
      if (err.statusCode) { reply.code(err.statusCode); return { error: err.message }; }
      throw err;
    }
  });

  // Remove a partner link
  fastify.delete('/accounts/:id/partners/:partnerId', {
    schema: {
      description: 'Remove a partner link from this account. Does not delete either account.',
      tags: ['accounts'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          partnerId: { type: 'integer' },
        },
      },
    },
  }, async (request) => {
    return accountsService.removePartner(request.userId, request.params.id, request.params.partnerId);
  });

  // Delete
  fastify.delete('/accounts/:id', {
    schema: {
      description: 'Delete an account, its meetings, opportunities, notes, and partner links. Also deletes any kind=account contacts whose only account link was this one; contacts shared with other accounts (and all partner/internal contacts) are preserved.',
      tags: ['accounts'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const deleted = await accountsService.delete(request.userId, request.params.id);
    if (!deleted) {
      reply.code(404);
      return { error: 'Account not found' };
    }
    return {
      deleted: true,
      slug: deleted.slug,
      deleted_contact_ids: deleted.deleted_contact_ids,
      deleted_contact_count: deleted.deleted_contact_count,
    };
  });
}
