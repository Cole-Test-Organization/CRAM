// Vendor products — global catalog of products under vendors, used by
// account_details *_ids arrays to pin "what does this account run for X".

export default async function vendorProductRoutes(fastify, { vendorProductsService }) {
  fastify.get('/vendor-products', {
    schema: {
      description: 'List vendor products. Filter by vendor_id, vendor_slug, category, or search.',
      tags: ['vendor-products'],
      querystring: {
        type: 'object',
        properties: {
          vendor_id: { type: 'integer' },
          vendor_slug: { type: 'string' },
          category: { type: 'string', description: 'e.g. firewall, edr, siem, idp, mfa, sase, ...' },
          search: { type: 'string', description: 'ILIKE match on product name or vendor name' },
          needs_review: { type: 'boolean' },
          include_deleted: { type: 'boolean', default: false },
          limit: { type: 'integer', minimum: 1, maximum: 500, default: 200 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request) => {
    return vendorProductsService.getAll(request.query);
  });

  fastify.get('/vendor-products/:id', {
    schema: {
      description: 'Get a single vendor product by ID (includes vendor name and slug).',
      tags: ['vendor-products'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const product = await vendorProductsService.getById(request.params.id);
    if (!product) { reply.code(404); return { error: 'Vendor product not found' }; }
    return product;
  });

  fastify.post('/vendor-products/find-or-create', {
    schema: {
      description: 'Idempotent vendor product creation. Pass vendor_id (existing vendor) or vendor_name (auto-creates the vendor if needed). Returns the existing product if (vendor_id, slug) matches OR if a trigram fuzzy match against existing rows in the same vendor + category exceeds the similarity threshold (response includes matched_by="fuzzy" and match_score in that case). Otherwise creates with needs_review=true.',
      tags: ['vendor-products'],
      body: {
        type: 'object',
        required: ['name', 'category'],
        properties: {
          vendor_id: { type: 'integer', description: 'Existing vendor; mutually exclusive with vendor_name' },
          vendor_name: { type: 'string', description: 'Auto-creates the vendor if missing' },
          name: { type: 'string', minLength: 1 },
          slug: { type: 'string', description: 'Optional; derived from name if omitted' },
          category: { type: 'string', minLength: 1, description: 'e.g. firewall, edr, siem' },
          notes: { type: 'string', nullable: true },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const result = await vendorProductsService.findOrCreate(request.body);
      reply.code(result.created ? 201 : 200);
      return result;
    } catch (err) {
      if (err.statusCode) { reply.code(err.statusCode); return { error: err.message }; }
      throw err;
    }
  });

  fastify.patch('/vendor-products/:id', {
    schema: {
      description: 'Partial update of a vendor product. vendor_id cannot be changed (create a new product instead).',
      tags: ['vendor-products'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 },
          slug: { type: 'string', minLength: 1 },
          category: { type: 'string', minLength: 1 },
          notes: { type: 'string', nullable: true },
          needs_review: { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const product = await vendorProductsService.patch(request.params.id, request.body);
      if (!product) { reply.code(404); return { error: 'Vendor product not found' }; }
      return product;
    } catch (err) {
      if (err.statusCode) { reply.code(err.statusCode); return { error: err.message }; }
      if (err.code === '23505') { reply.code(409); return { error: 'Slug already in use for this vendor' }; }
      throw err;
    }
  });

  fastify.delete('/vendor-products/:id', {
    schema: {
      description: 'Soft-delete a vendor product (sets deleted_at). References in account_details arrays are preserved.',
      tags: ['vendor-products'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const deleted = await vendorProductsService.softDelete(request.params.id);
    if (!deleted) { reply.code(404); return { error: 'Vendor product not found or already deleted' }; }
    return { deleted: true, product: deleted };
  });

  fastify.post('/vendor-products/:id/restore', {
    schema: {
      description: 'Restore a soft-deleted vendor product.',
      tags: ['vendor-products'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const restored = await vendorProductsService.restore(request.params.id);
    if (!restored) { reply.code(404); return { error: 'Vendor product not found' }; }
    return restored;
  });
}
