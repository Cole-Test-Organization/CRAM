export default async function productRoutes(fastify, { productsService }) {
  fastify.get('/products', {
    schema: {
      description: 'List products. Supports filtering by category and name search.',
      tags: ['products'],
      querystring: {
        type: 'object',
        properties: {
          category_id: { type: 'integer', description: 'Filter by category ID' },
          search: { type: 'string', description: 'ILIKE match on name' },
          limit: { type: 'integer', minimum: 1, description: 'Optional. Omit to return all rows.' },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request) => {
    return productsService.getAll(request.userId, request.query);
  });

  fastify.get('/products/:id', {
    schema: {
      description: 'Get a single product by ID (includes category name).',
      tags: ['products'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const product = await productsService.getById(request.userId, request.params.id);
    if (!product) { reply.code(404); return { error: 'Product not found' }; }
    return product;
  });

  fastify.post('/products', {
    schema: {
      description: 'Create a product. Optionally assign a category.',
      tags: ['products'],
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1 },
          category_id: { type: 'integer', nullable: true, description: 'Optional product_categories.id' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const product = await productsService.create(request.userId, request.body);
      reply.code(201);
      return product;
    } catch (err) {
      if (err.statusCode === 400) { reply.code(400); return { error: err.message }; }
      if (err.code === '23505') { reply.code(409); return { error: `Product "${request.body.name}" already exists` }; }
      throw err;
    }
  });

  fastify.patch('/products/:id', {
    schema: {
      description: 'Partial update of a product.',
      tags: ['products'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 },
          category_id: { type: 'integer', nullable: true, description: 'Pass null to clear the category' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const product = await productsService.patch(request.userId, request.params.id, request.body);
      if (!product) { reply.code(404); return { error: 'Product not found' }; }
      return product;
    } catch (err) {
      if (err.statusCode === 400) { reply.code(400); return { error: err.message }; }
      if (err.code === '23505') { reply.code(409); return { error: `Product "${request.body.name}" already exists` }; }
      throw err;
    }
  });

  fastify.delete('/products/:id', {
    schema: {
      description: 'Delete a product. Also removes it from any opportunities it was linked to.',
      tags: ['products'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const deleted = await productsService.delete(request.userId, request.params.id);
    if (!deleted) { reply.code(404); return { error: 'Product not found' }; }
    return { deleted: true, name: deleted.name };
  });
}
