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
      description: 'Get an account org chart. Returns every eligible account contact in contacts, explicit chart members in nodes, root ids, and reporting edges.',
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
      description: 'Place one contact in the account org chart. Pass a manager id to report to that contact, or null to make this contact explicitly top-level.',
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
        return { error: 'reports_to_contact_id is required; pass a contact id or null for top-level.' };
      }
      const managerId = request.body?.reports_to_contact_id ?? null;
      return await orgChartService.setManager(request.userId, request.params.accountId, request.params.contactId, managerId);
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode) { reply.code(e.statusCode); return { error: e.message }; }
      throw err;
    }
  });

  fastify.delete<{ Params: { accountId: number; contactId: number } }>('/accounts/:accountId/org-chart/contacts/:contactId', {
    schema: {
      description: 'Remove one contact from the account org chart without unlinking the contact from the account. Direct reports must be reassigned first.',
      tags: ['org-chart'],
      params: {
        type: 'object',
        required: ['accountId', 'contactId'],
        properties: {
          accountId: { type: 'integer' },
          contactId: { type: 'integer' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      return await orgChartService.remove(request.userId, request.params.accountId, request.params.contactId);
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode) { reply.code(e.statusCode); return { error: e.message }; }
      throw err;
    }
  });

  fastify.put<{
    Params: { accountId: number };
    Body: { edges?: Array<{ contact_id: number; reports_to_contact_id: number }>; root_contact_ids?: number[] };
  }>('/accounts/:accountId/org-chart', {
    schema: {
      description: 'Replace the entire account org chart. root_contact_ids are explicit top-level contacts; edge endpoints also become members. Contacts omitted from both are unassigned.',
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
          root_contact_ids: { type: 'array', items: { type: 'integer' } },
        },
      },
    },
  }, async (request, reply) => {
    try {
      return await orgChartService.replace(
        request.userId,
        request.params.accountId,
        request.body?.edges || [],
        request.body?.root_contact_ids || [],
      );
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode) { reply.code(e.statusCode); return { error: e.message }; }
      throw err;
    }
  });
}
