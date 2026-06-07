// Async enrichment endpoints: browser-driven LinkedIn + web lookups take 30-60s
// per request, so callers enqueue a job and poll for the result.

import type { FastifyInstance } from 'fastify';
import type { OutreachService } from '../../services/outreach/outreach.js';

const enrichBodySchema = {
  type: 'object',
  required: ['type', 'name'],
  properties: {
    type: { type: 'string', enum: ['person', 'company', 'industry'], description: 'What to enrich' },
    name: { type: 'string', description: 'Person name, company name, or industry area' },
    company: { type: 'string', description: 'Filter by company (person only)' },
    title: { type: 'string', description: 'Filter by title (person only)' },
    deep: { type: 'boolean', description: 'Include deep profile scrape (slower)' },
    limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max companies (industry only)' },
    linkedin: { type: 'boolean', default: true, description: 'Hit LinkedIn (requires cookies)' },
  },
};

const jobSchema = {
  type: 'object',
  properties: {
    jobId: { type: 'string' },
    type: { type: 'string' },
    params: { type: 'object', additionalProperties: true },
    status: { type: 'string', enum: ['queued', 'running', 'completed', 'failed'] },
    result: { type: ['object', 'null'], additionalProperties: true },
    error: { type: ['string', 'null'] },
    createdAt: { type: 'string' },
    startedAt: { type: ['string', 'null'] },
    completedAt: { type: ['string', 'null'] },
    position: { type: 'integer' },
  },
};

export default async function outreachRoutes(fastify: FastifyInstance, { outreachService }: { outreachService: OutreachService }) {
  fastify.post<{ Body: { type: string; name: string; company?: string; title?: string; deep?: boolean; limit?: number; linkedin?: boolean } }>('/outreach/enrich', {
    schema: {
      description: 'Enqueue an enrichment job (person/company/industry). Returns a jobId — poll GET /outreach/enrich/:jobId for the result. Jobs run serially (single LinkedIn session, rate-limited).',
      tags: ['outreach'],
      body: enrichBodySchema,
      response: { 202: jobSchema },
    },
  }, async (request, reply) => {
    try {
      const job = outreachService.enqueue(request.body);
      reply.code(202);
      return job;
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      reply.code(e.statusCode || 500);
      return { error: e.message };
    }
  });

  fastify.get<{ Params: { jobId: string } }>('/outreach/enrich/:jobId', {
    schema: {
      description: 'Get the current state of an enrichment job. Poll until status is completed or failed.',
      tags: ['outreach'],
      params: {
        type: 'object',
        properties: { jobId: { type: 'string' } },
        required: ['jobId'],
      },
    },
  }, async (request, reply) => {
    const job = outreachService.getJob(request.params.jobId);
    if (!job) {
      reply.code(404);
      return { error: `Job not found: ${request.params.jobId}` };
    }
    return job;
  });

  fastify.get<{ Querystring: { status?: string; limit?: number } }>('/outreach/enrich', {
    schema: {
      description: 'List enrichment jobs (most recent first). Filter by status.',
      tags: ['outreach'],
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['queued', 'running', 'completed', 'failed'] },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
        },
      },
    },
  }, async (request) => {
    return outreachService.listJobs(request.query);
  });

  fastify.get('/outreach/stats', {
    schema: {
      description: 'Queue depth, job counts by status, and LinkedIn rate-limit state (daily count / cap, last request).',
      tags: ['outreach'],
    },
  }, async () => {
    return outreachService.getStats();
  });
}
