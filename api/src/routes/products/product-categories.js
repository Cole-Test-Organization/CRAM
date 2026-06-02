export default async function productCategoryRoutes(fastify, { productCategoriesService }) {
  fastify.get('/product-categories', {
    schema: {
      description: 'List all product categories with product counts.',
      tags: ['products'],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, description: 'Optional. Omit to return all rows.' },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request) => {
    return productCategoriesService.getAll(request.userId, request.query);
  });

  fastify.get('/product-categories/:id', {
    schema: {
      description: 'Get a single product category by ID.',
      tags: ['products'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const category = await productCategoriesService.getById(request.userId, request.params.id);
    if (!category) { reply.code(404); return { error: 'Product category not found' }; }
    return category;
  });

  fastify.post('/product-categories', {
    schema: {
      description: 'Create a product category.',
      tags: ['products'],
      body: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string', minLength: 1 } },
      },
    },
  }, async (request, reply) => {
    try {
      const category = await productCategoriesService.create(request.userId, request.body);
      reply.code(201);
      return category;
    } catch (err) {
      if (err.statusCode === 400) { reply.code(400); return { error: err.message }; }
      if (err.code === '23505') { reply.code(409); return { error: `Category "${request.body.name}" already exists` }; }
      throw err;
    }
  });

  fastify.patch('/product-categories/:id', {
    schema: {
      description: 'Update a product category. Renaming updates the canonical name; products keep their FK.',
      tags: ['products'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: { name: { type: 'string', minLength: 1 } },
      },
    },
  }, async (request, reply) => {
    try {
      const category = await productCategoriesService.patch(request.userId, request.params.id, request.body);
      if (!category) { reply.code(404); return { error: 'Product category not found' }; }
      return category;
    } catch (err) {
      if (err.statusCode === 400) { reply.code(400); return { error: err.message }; }
      if (err.code === '23505') { reply.code(409); return { error: `Category "${request.body.name}" already exists` }; }
      throw err;
    }
  });

  fastify.delete('/product-categories/:id', {
    schema: {
      description: 'Delete a product category. Products in this category get their category cleared (FK set to NULL).',
      tags: ['products'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const deleted = await productCategoriesService.delete(request.userId, request.params.id);
    if (!deleted) { reply.code(404); return { error: 'Product category not found' }; }
    return { deleted: true, name: deleted.name };
  });
}
