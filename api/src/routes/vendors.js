// Vendor catalog — global, shared across all users (no RLS).
// `needs_review` flags an auto-created vendor for later canonicalization.

export default async function vendorRoutes(fastify, { vendorsService }) {
  fastify.get('/vendors', {
    schema: {
      description: 'List vendors from the global catalog. Soft-deleted rows are excluded unless include_deleted=true.',
      tags: ['vendors'],
      querystring: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'ILIKE match on name or slug' },
          needs_review: { type: 'boolean', description: 'Filter to vendors flagged for review (auto-created, not yet canonicalized)' },
          include_deleted: { type: 'boolean', default: false },
          limit: { type: 'integer', minimum: 1, maximum: 500, default: 200 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request) => {
    return vendorsService.getAll(request.query);
  });

  fastify.get('/vendors/:id', {
    schema: {
      description: 'Get a single vendor by ID.',
      tags: ['vendors'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const vendor = await vendorsService.getById(request.params.id);
    if (!vendor) { reply.code(404); return { error: 'Vendor not found' }; }
    return vendor;
  });

  fastify.post('/vendors/find-or-create', {
    schema: {
      description: 'Idempotent vendor creation. Returns the existing vendor if a row with the same slug (derived from name if not supplied) exists; otherwise creates one with needs_review=true.',
      tags: ['vendors'],
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1 },
          slug: { type: 'string', description: 'Optional; derived from name if omitted' },
          website: { type: 'string', nullable: true },
          notes: { type: 'string', nullable: true },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const result = await vendorsService.findOrCreate(request.body);
      reply.code(result.created ? 201 : 200);
      return result;
    } catch (err) {
      if (err.statusCode) { reply.code(err.statusCode); return { error: err.message }; }
      throw err;
    }
  });

  fastify.patch('/vendors/:id', {
    schema: {
      description: 'Partial update of a vendor.',
      tags: ['vendors'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 },
          slug: { type: 'string', minLength: 1 },
          website: { type: 'string', nullable: true },
          notes: { type: 'string', nullable: true },
          needs_review: { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const vendor = await vendorsService.patch(request.params.id, request.body);
      if (!vendor) { reply.code(404); return { error: 'Vendor not found' }; }
      return vendor;
    } catch (err) {
      if (err.statusCode) { reply.code(err.statusCode); return { error: err.message }; }
      if (err.code === '23505') { reply.code(409); return { error: 'Slug already in use' }; }
      throw err;
    }
  });

  fastify.delete('/vendors/:id', {
    schema: {
      description: 'Soft-delete a vendor (sets deleted_at). References in account_details arrays are preserved.',
      tags: ['vendors'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const deleted = await vendorsService.softDelete(request.params.id);
    if (!deleted) { reply.code(404); return { error: 'Vendor not found or already deleted' }; }
    return { deleted: true, vendor: deleted };
  });

  fastify.post('/vendors/:id/restore', {
    schema: {
      description: 'Restore a soft-deleted vendor (clears deleted_at).',
      tags: ['vendors'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const restored = await vendorsService.restore(request.params.id);
    if (!restored) { reply.code(404); return { error: 'Vendor not found' }; }
    return restored;
  });
}
