// Threads + their tasks + their contact pool. Everything is nested under
// /threads so the feature is one resource tree. Open-only by default; pass
// include_closed=true to see closed threads. The service throws http-errors
// (statusCode set) which we surface verbatim; anything else bubbles to a 500.

import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ThreadsService } from '../../services/threads/threads.js';

export default async function threadRoutes(fastify: FastifyInstance, { threadsService }: { threadsService: ThreadsService }) {
  const fail = (reply: FastifyReply, err: unknown) => {
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode) { reply.code(e.statusCode); return { error: e.message }; }
    throw err;
  };

  // ── threads ────────────────────────────────────────────────────────────────

  fastify.get<{ Querystring: { account_id: number; include_closed?: boolean } }>('/threads', {
    schema: {
      description: 'List threads for one account, each enriched with its tasks and contact pool. Open threads only unless include_closed=true. Newest/open first.',
      tags: ['threads'],
      querystring: {
        type: 'object',
        required: ['account_id'],
        properties: {
          account_id: { type: 'integer', description: 'Account whose threads to list.' },
          include_closed: { type: 'boolean', default: false, description: 'Include closed threads (hidden by default).' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      return await threadsService.getAllForAccount(request.userId, request.query.account_id, {
        include_closed: request.query.include_closed,
      });
    } catch (err) { return fail(reply, err); }
  });

  fastify.get<{ Params: { id: number } }>('/threads/:id', {
    schema: {
      description: 'Get one thread by id, enriched with tasks and contact pool.',
      tags: ['threads'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const thread = await threadsService.getById(request.userId, request.params.id);
    if (!thread) { reply.code(404); return { error: 'Thread not found' }; }
    return thread;
  });

  fastify.post<{ Body: { account_id: number; title: string; description?: string | null; contact_ids?: number[] } }>('/threads', {
    schema: {
      description: 'Create a thread (an open workstream) on an account. Optionally seed the contact pool with contact_ids.',
      tags: ['threads'],
      body: {
        type: 'object',
        required: ['account_id', 'title'],
        properties: {
          account_id: { type: 'integer' },
          title: { type: 'string', minLength: 1 },
          description: { type: ['string', 'null'] },
          contact_ids: { type: 'array', items: { type: 'integer' }, description: 'Optional initial contact pool.' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const thread = await threadsService.create(request.userId, request.body);
      reply.code(201);
      return thread;
    } catch (err) { return fail(reply, err); }
  });

  fastify.patch<{ Params: { id: number }; Body: { title?: string; description?: string | null; closed?: boolean } }>('/threads/:id', {
    schema: {
      description: 'Update a thread. Only fields sent are changed. closed=true closes it (kept for history, hidden by default); closed=false reopens.',
      tags: ['threads'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1 },
          description: { type: ['string', 'null'] },
          closed: { type: 'boolean', description: 'true = close, false = reopen.' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const thread = await threadsService.patch(request.userId, request.params.id, request.body);
      if (!thread) { reply.code(404); return { error: 'Thread not found' }; }
      return thread;
    } catch (err) { return fail(reply, err); }
  });

  fastify.delete<{ Params: { id: number } }>('/threads/:id', {
    schema: {
      description: 'Delete a thread and all its tasks + contact links (cascade). Prefer closing (PATCH closed=true) to keep history.',
      tags: ['threads'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const deleted = await threadsService.delete(request.userId, request.params.id);
    if (!deleted) { reply.code(404); return { error: 'Thread not found' }; }
    return { deleted: true, id: deleted.id };
  });

  // ── tasks (nested under a thread) ───────────────────────────────────────────

  fastify.post<{ Params: { id: number }; Body: { title: string; description?: string | null; assignee_contact_id?: number | null; due_date?: string | null } }>('/threads/:id/tasks', {
    schema: {
      description: 'Add a task to a thread. assignee_contact_id is optional (omit/null = no one assigned). due_date is a plain YYYY-MM-DD date.',
      tags: ['threads'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string', minLength: 1 },
          description: { type: ['string', 'null'] },
          assignee_contact_id: { type: ['integer', 'null'], description: 'A contact id; null/omitted = no one.' },
          due_date: { type: ['string', 'null'], format: 'date', description: 'YYYY-MM-DD.' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const task = await threadsService.createTask(request.userId, request.params.id, request.body);
      reply.code(201);
      return task;
    } catch (err) { return fail(reply, err); }
  });

  fastify.patch<{ Params: { id: number; taskId: number }; Body: { title?: string; description?: string | null; assignee_contact_id?: number | null; due_date?: string | null; completed?: boolean } }>('/threads/:id/tasks/:taskId', {
    schema: {
      description: 'Update a task. Only fields sent change. assignee_contact_id=null clears the assignee; completed=true/false toggles done.',
      tags: ['threads'],
      params: { type: 'object', properties: { id: { type: 'integer' }, taskId: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1 },
          description: { type: ['string', 'null'] },
          assignee_contact_id: { type: ['integer', 'null'] },
          due_date: { type: ['string', 'null'], format: 'date' },
          completed: { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const task = await threadsService.patchTask(request.userId, request.params.taskId, request.body);
      if (!task) { reply.code(404); return { error: 'Task not found' }; }
      return task;
    } catch (err) { return fail(reply, err); }
  });

  fastify.delete<{ Params: { id: number; taskId: number } }>('/threads/:id/tasks/:taskId', {
    schema: {
      description: 'Delete a task.',
      tags: ['threads'],
      params: { type: 'object', properties: { id: { type: 'integer' }, taskId: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const deleted = await threadsService.deleteTask(request.userId, request.params.taskId);
    if (!deleted) { reply.code(404); return { error: 'Task not found' }; }
    return { deleted: true, id: deleted.id };
  });

  // ── contact pool ────────────────────────────────────────────────────────────

  fastify.post<{ Params: { id: number }; Body: { contact_id: number } }>('/threads/:id/contacts', {
    schema: {
      description: 'Add a contact to the thread\'s involved-people pool (the set you assign tasks from). Returns the enriched thread.',
      tags: ['threads'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        required: ['contact_id'],
        properties: { contact_id: { type: 'integer' } },
      },
    },
  }, async (request, reply) => {
    try {
      return await threadsService.linkContact(request.userId, request.params.id, request.body.contact_id);
    } catch (err) { return fail(reply, err); }
  });

  fastify.delete<{ Params: { id: number; contactId: number } }>('/threads/:id/contacts/:contactId', {
    schema: {
      description: 'Remove a contact from the thread\'s pool. Does not unassign tasks already assigned to them.',
      tags: ['threads'],
      params: { type: 'object', properties: { id: { type: 'integer' }, contactId: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    try {
      return await threadsService.unlinkContact(request.userId, request.params.id, request.params.contactId);
    } catch (err) { return fail(reply, err); }
  });
}
