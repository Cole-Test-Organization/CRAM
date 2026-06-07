import type { FastifyInstance } from 'fastify';
import type { ProductCategoriesService } from '../../services/products/product-categories.js';

export default async function productCategoryRoutes(fastify: FastifyInstance, { productCategoriesService }: { productCategoriesService: ProductCategoriesService }) {
  fastify.get<{ Querystring: { limit?: number; offset?: number } }>('/product-categories', {
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

  fastify.get<{ Params: { id: number } }>('/product-categories/:id', {
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

  fastify.post<{ Body: { name: string } }>('/product-categories', {
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
      const e = err as { statusCode?: number; code?: string; message?: string };
      if (e.statusCode === 400) { reply.code(400); return { error: e.message }; }
      if (e.code === '23505') { reply.code(409); return { error: `Category "${request.body.name}" already exists` }; }
      throw err;
    }
  });

  fastify.patch<{ Params: { id: number }; Body: { name?: string } }>('/product-categories/:id', {
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
      const e = err as { statusCode?: number; code?: string; message?: string };
      if (e.statusCode === 400) { reply.code(400); return { error: e.message }; }
      if (e.code === '23505') { reply.code(409); return { error: `Category "${request.body.name}" already exists` }; }
      throw err;
    }
  });

  fastify.delete<{ Params: { id: number } }>('/product-categories/:id', {
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
