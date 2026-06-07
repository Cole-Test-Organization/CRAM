const STAGE_ENUM = [
  'opp_identification',
  'tech_discovery',
  'non_pov_tech_validation',
  'pov_planning',
  'pov_tech_validation',
  'tech_decision_pending',
  'tech_loss_closed',
  'tech_win_closed',
  'no_tech_validation_closed',
];

import type { FastifyInstance } from 'fastify';
import type { OpportunitiesService } from '../../services/opportunities/opportunities.js';
import type { AccountsService } from '../../services/accounts/accounts.js';

export default async function opportunityRoutes(fastify: FastifyInstance, { opportunitiesService, accountsService }: { opportunitiesService: OpportunitiesService; accountsService: AccountsService }) {
  fastify.get<{ Querystring: { account_id?: number; stage?: string; sort?: string; order?: string; limit?: number; offset?: number } }>('/opportunities', {
    schema: {
      description: 'List opportunities. Filter by account_id and/or stage; sort/paginate.',
      tags: ['opportunities'],
      querystring: {
        type: 'object',
        properties: {
          account_id: { type: 'integer' },
          stage: { type: 'string', enum: STAGE_ENUM },
          sort: { type: 'string', enum: ['name', 'stage', 'created_at', 'updated_at'], default: 'created_at' },
          order: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
          limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request) => {
    return opportunitiesService.getAll(request.userId, request.query);
  });

  fastify.get<{ Params: { accountId: number } }>('/accounts/:accountId/opportunities', {
    schema: {
      description: 'List opportunities for a specific account.',
      tags: ['opportunities'],
      params: { type: 'object', properties: { accountId: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const account = await accountsService.getById(request.userId, request.params.accountId);
    if (!account) { reply.code(404); return { error: 'Account not found' }; }
    return opportunitiesService.getByAccount(request.userId, request.params.accountId);
  });

  fastify.get<{ Params: { id: number } }>('/opportunities/:id', {
    schema: {
      description: 'Get an opportunity by ID. Includes the linked account name/slug and the products on the opp.',
      tags: ['opportunities'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const opp = await opportunitiesService.getById(request.userId, request.params.id);
    if (!opp) { reply.code(404); return { error: 'Opportunity not found' }; }
    return opp;
  });

  fastify.post<{ Body: { account_id: number; name: string; opp_link?: string; trr_link?: string; tech_validation_link?: string; stage?: string; notes?: string; product_ids?: number[]; why_change?: string[]; why_now?: string[]; why_us?: string[] } }>('/opportunities', {
    schema: {
      description: 'Create an opportunity. The linked account must not be a partner account (status=partner is rejected). Optionally attach products via product_ids. Use why_change / why_now / why_us to seed the Why-Change/Why-Now/Why-Us reason lists (ordered, oldest-first; new reasons append at the end).',
      tags: ['opportunities'],
      body: {
        type: 'object',
        required: ['account_id', 'name'],
        properties: {
          account_id: { type: 'integer' },
          name: { type: 'string', minLength: 1 },
          opp_link: { type: 'string', description: 'Optional link to the deal record in an external system' },
          trr_link: { type: 'string', description: 'Optional link to a Technical Requirements Review doc' },
          tech_validation_link: { type: 'string', description: 'Optional link to the tech-validation artifact (POV plan, validation doc, demo recording, etc.)' },
          stage: { type: 'string', enum: STAGE_ENUM, default: 'opp_identification' },
          notes: { type: 'string' },
          product_ids: { type: 'array', items: { type: 'integer' }, description: 'Products to attach to this opp' },
          why_change: { type: 'array', items: { type: 'string' }, description: 'Reasons the account needs to change (ordered, oldest first)' },
          why_now: { type: 'array', items: { type: 'string' }, description: 'Reasons the timing is now (ordered, oldest first)' },
          why_us: { type: 'array', items: { type: 'string' }, description: 'Reasons the account should choose us (ordered, oldest first)' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const opp = await opportunitiesService.create(request.userId, request.body);
      reply.code(201);
      return opp;
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode) { reply.code(e.statusCode); return { error: e.message }; }
      throw err;
    }
  });

  fastify.patch<{ Params: { id: number }; Body: { account_id?: number; name?: string; opp_link?: string | null; trr_link?: string | null; tech_validation_link?: string | null; stage?: string; notes?: string | null; product_ids?: number[]; why_change?: string[]; why_now?: string[]; why_us?: string[] } }>('/opportunities/:id', {
    schema: {
      description: 'Partial update. Pass product_ids to fully replace the linked products (empty array clears them). Likewise why_change / why_now / why_us each fully replace the corresponding reason list when sent — to add or remove a single reason, GET the opp, mutate the array, and PATCH the full list back.',
      tags: ['opportunities'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: {
          account_id: { type: 'integer' },
          name: { type: 'string', minLength: 1 },
          opp_link: { type: 'string', nullable: true },
          trr_link: { type: 'string', nullable: true },
          tech_validation_link: { type: 'string', nullable: true },
          stage: { type: 'string', enum: STAGE_ENUM },
          notes: { type: 'string', nullable: true },
          product_ids: { type: 'array', items: { type: 'integer' } },
          why_change: { type: 'array', items: { type: 'string' } },
          why_now: { type: 'array', items: { type: 'string' } },
          why_us: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const opp = await opportunitiesService.patch(request.userId, request.params.id, request.body);
      if (!opp) { reply.code(404); return { error: 'Opportunity not found' }; }
      return opp;
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode) { reply.code(e.statusCode); return { error: e.message }; }
      throw err;
    }
  });

  fastify.delete<{ Params: { id: number } }>('/opportunities/:id', {
    schema: {
      description: 'Delete an opportunity. Cascades to opp_products links.',
      tags: ['opportunities'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const deleted = await opportunitiesService.delete(request.userId, request.params.id);
    if (!deleted) { reply.code(404); return { error: 'Opportunity not found' }; }
    return { deleted: true, name: deleted.name };
  });

  fastify.post<{ Params: { id: number; productId: number } }>('/opportunities/:id/products/:productId', {
    schema: {
      description: 'Link a single product to an opportunity (idempotent).',
      tags: ['opportunities'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          productId: { type: 'integer' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const opp = await opportunitiesService.linkProduct(request.userId, request.params.id, request.params.productId);
      if (!opp) { reply.code(404); return { error: 'Opportunity not found' }; }
      return opp;
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode) { reply.code(e.statusCode); return { error: e.message }; }
      throw err;
    }
  });

  fastify.delete<{ Params: { id: number; productId: number } }>('/opportunities/:id/products/:productId', {
    schema: {
      description: 'Unlink a single product from an opportunity.',
      tags: ['opportunities'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          productId: { type: 'integer' },
        },
      },
    },
  }, async (request, reply) => {
    const opp = await opportunitiesService.unlinkProduct(request.userId, request.params.id, request.params.productId);
    if (!opp) { reply.code(404); return { error: 'Opportunity not found' }; }
    return opp;
  });
}
