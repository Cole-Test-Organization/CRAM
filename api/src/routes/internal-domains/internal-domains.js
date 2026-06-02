// Per-user internal-domain management. Powers the Settings → Internal Domains
// panel and is consulted by the from-emails meeting flow to decide whether an
// attendee should be flagged kind=internal (skip account creation + research).

export default async function internalDomainRoutes(fastify, { internalDomainsService }) {
  fastify.get('/internal-domains', {
    schema: {
      description: 'List the caller\'s internal email domains. These are the domains belonging to the user\'s own company — emails from them are flagged kind=internal in the from-emails meeting flow so they don\'t trigger account creation or research.',
      tags: ['internal-domains'],
      response: {
        200: {
          type: 'object',
          properties: {
            domains: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  domain: { type: 'string' },
                  created_at: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  }, async (request) => {
    const domains = await internalDomainsService.list(request.userId);
    return { domains };
  });

  fastify.post('/internal-domains', {
    schema: {
      description: 'Add an internal domain. Idempotent — adding an existing domain returns the existing row. The domain is normalized (lowercased, www./protocol/subpath stripped) before storage; the returned `domain` is the canonical form.',
      tags: ['internal-domains'],
      body: {
        type: 'object',
        required: ['domain'],
        properties: {
          domain: { type: 'string', description: 'Bare domain like "paloaltonetworks.com" — accepts URLs and www. prefixes too.' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const row = await internalDomainsService.add(request.userId, request.body.domain);
      reply.code(201);
      return row;
    } catch (err) {
      if (err.statusCode === 400) { reply.code(400); return { error: err.message }; }
      throw err;
    }
  });

  fastify.delete('/internal-domains/:domain', {
    schema: {
      description: 'Remove an internal domain. The :domain path param is URL-decoded and re-normalized before lookup, so calling DELETE with any form (www., https://, trailing path) of a stored domain works.',
      tags: ['internal-domains'],
      params: { type: 'object', required: ['domain'], properties: { domain: { type: 'string' } } },
    },
  }, async (request, reply) => {
    try {
      const result = await internalDomainsService.remove(request.userId, decodeURIComponent(request.params.domain));
      if (!result.deleted) { reply.code(404); return { error: `Internal domain not found: ${result.domain}` }; }
      return result;
    } catch (err) {
      if (err.statusCode === 400) { reply.code(400); return { error: err.message }; }
      throw err;
    }
  });
}
