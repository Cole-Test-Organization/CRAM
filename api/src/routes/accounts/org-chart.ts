import type { FastifyInstance } from 'fastify';
import type { OrgChartService } from '../../services/accounts/org-chart.js';

const ORG_CHART_EDGE = {
  type: 'object',
  required: ['contact_id', 'reports_to_contact_id'],
  properties: {
    contact_id: { type: 'integer', description: 'Contact linked to this account.' },
    reports_to_contact_id: { type: 'integer', description: 'The account contact this person reports to.' },
  },
};

export default async function orgChartRoutes(fastify: FastifyInstance, { orgChartService }: { orgChartService: OrgChartService }) {
  fastify.get<{ Params: { accountId: number } }>('/accounts/:accountId/org-chart', {
    schema: {
      description: 'Get an account org chart. Returns every external contact linked to the account as nodes, plus reporting edges scoped to that account.',
      tags: ['org-chart'],
      params: {
        type: 'object',
        required: ['accountId'],
        properties: { accountId: { type: 'integer' } },
      },
    },
  }, async (request, reply) => {
    try {
      return await orgChartService.getByAccountId(request.userId, request.params.accountId);
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode) { reply.code(e.statusCode); return { error: e.message }; }
      throw err;
    }
  });

  fastify.patch<{
    Params: { accountId: number; contactId: number };
    Body: { reports_to_contact_id?: number | null };
  }>('/accounts/:accountId/org-chart/contacts/:contactId', {
    schema: {
      description: 'Set or clear one contact manager in the account org chart. Pass reports_to_contact_id=null to make the contact a root.',
      tags: ['org-chart'],
      params: {
        type: 'object',
        required: ['accountId', 'contactId'],
        properties: {
          accountId: { type: 'integer' },
          contactId: { type: 'integer' },
        },
      },
      body: {
        type: 'object',
        required: ['reports_to_contact_id'],
        properties: {
          reports_to_contact_id: { type: 'integer', nullable: true },
        },
      },
    },
  }, async (request, reply) => {
    try {
      if (!request.body || !Object.hasOwn(request.body, 'reports_to_contact_id')) {
        reply.code(400);
        return { error: 'reports_to_contact_id is required; pass a contact id or null to clear.' };
      }
      const managerId = request.body?.reports_to_contact_id ?? null;
      return await orgChartService.setManager(request.userId, request.params.accountId, request.params.contactId, managerId);
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode) { reply.code(e.statusCode); return { error: e.message }; }
      throw err;
    }
  });

  fastify.put<{ Params: { accountId: number }; Body: { edges?: Array<{ contact_id: number; reports_to_contact_id: number }> } }>('/accounts/:accountId/org-chart', {
    schema: {
      description: 'Replace the entire account org chart edge set. Contacts omitted from edges become roots. Rejects non-account contacts, duplicate managers, self-reports, and cycles.',
      tags: ['org-chart'],
      params: {
        type: 'object',
        required: ['accountId'],
        properties: { accountId: { type: 'integer' } },
      },
      body: {
        type: 'object',
        required: ['edges'],
        properties: {
          edges: { type: 'array', items: ORG_CHART_EDGE },
        },
      },
    },
  }, async (request, reply) => {
    try {
      return await orgChartService.replace(request.userId, request.params.accountId, request.body?.edges || []);
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode) { reply.code(e.statusCode); return { error: e.message }; }
      throw err;
    }
  });
}
