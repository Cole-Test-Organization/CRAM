// Per-user agent memory management. Enabled memories are rendered into the
// agent's system prompt at session start (via buildAgentMarkdown), so writes
// here surface to the agent on its next session — no live mutation of an
// active session's prompt.
import type { FastifyInstance } from 'fastify';
import type { MemoriesService } from '../../services/memories/memories.js';

export default async function memoryRoutes(fastify: FastifyInstance, { memoriesService }: { memoriesService: MemoriesService }) {
  fastify.get<{ Querystring: { enabled?: boolean; search?: string; limit?: number; offset?: number } }>('/memories', {
    schema: {
      description: 'List the caller\'s saved memories — long-lived preferences/rules/facts that get rendered into the agent\'s system prompt at session start. Newest first. Filters: `enabled` (true/false), `search` (ILIKE on title and content).',
      tags: ['memories'],
      querystring: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          search:  { type: 'string' },
          limit:   { type: 'integer', minimum: 1, maximum: 500, default: 100 },
          offset:  { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request) => {
    return memoriesService.list(request.userId, request.query);
  });

  fastify.get<{ Params: { id: number } }>('/memories/:id', {
    schema: {
      description: 'Get a single memory by id.',
      tags: ['memories'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const memory = await memoriesService.getById(request.userId, request.params.id);
    if (!memory) { reply.code(404); return { error: 'Memory not found' }; }
    return memory;
  });

  fastify.post<{ Body: { title?: string | null; content: string; enabled?: boolean } }>('/memories', {
    schema: {
      description: 'Create a memory. Required: `content`. Optional: `title` (short label), `enabled` (defaults to true). The agent\'s rule is to only call this on explicit user request.',
      tags: ['memories'],
      body: {
        type: 'object',
        required: ['content'],
        properties: {
          title:   { type: ['string', 'null'] },
          content: { type: 'string', minLength: 1 },
          enabled: { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const memory = await memoriesService.create(request.userId, request.body);
      reply.code(201);
      return memory;
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode === 400) { reply.code(400); return { error: e.message }; }
      throw err;
    }
  });

  fastify.patch<{ Params: { id: number }; Body: { title?: string | null; content?: string; enabled?: boolean } }>('/memories/:id', {
    schema: {
      description: 'Update a memory. Send any subset of `title`, `content`, `enabled`. Omitted fields are unchanged. Toggling `enabled` is the soft-mute path — prefer it over delete when the user might want it back.',
      tags: ['memories'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: {
          title:   { type: ['string', 'null'] },
          content: { type: 'string', minLength: 1 },
          enabled: { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const memory = await memoriesService.patch(request.userId, request.params.id, request.body);
      if (!memory) { reply.code(404); return { error: 'Memory not found' }; }
      return memory;
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode === 400) { reply.code(400); return { error: e.message }; }
      throw err;
    }
  });

  fastify.delete<{ Params: { id: number } }>('/memories/:id', {
    schema: {
      description: 'Delete a memory permanently. Prefer PATCH with `enabled=false` to soft-mute if the user might want it back later.',
      tags: ['memories'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const deleted = await memoriesService.delete(request.userId, request.params.id);
    if (!deleted) { reply.code(404); return { error: 'Memory not found' }; }
    return { deleted: true, id: deleted.id };
  });
}
