export default async function noteRoutes(fastify, { notesService }) {
  fastify.get('/notes', {
    schema: {
      description: 'List notes for a single entity. Pass exactly one of account_id, contact_id, opportunity_id. Newest first.',
      tags: ['notes'],
      querystring: {
        type: 'object',
        properties: {
          account_id: { type: 'integer' },
          contact_id: { type: 'integer' },
          opportunity_id: { type: 'integer' },
          limit: { type: 'integer', minimum: 1, maximum: 500, default: 200 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    try {
      return await notesService.getAll(request.userId, request.query);
    } catch (err) {
      if (err.statusCode === 400) { reply.code(400); return { error: err.message }; }
      throw err;
    }
  });

  fastify.get('/notes/:id', {
    schema: {
      description: 'Get a single note by ID.',
      tags: ['notes'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const note = await notesService.getById(request.userId, request.params.id);
    if (!note) { reply.code(404); return { error: 'Note not found' }; }
    return note;
  });

  fastify.post('/notes', {
    schema: {
      description: 'Create a timestamped note attached to exactly one of account / contact / opportunity.',
      tags: ['notes'],
      body: {
        type: 'object',
        required: ['body'],
        properties: {
          account_id: { type: 'integer' },
          contact_id: { type: 'integer' },
          opportunity_id: { type: 'integer' },
          body: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const note = await notesService.create(request.userId, request.body);
      reply.code(201);
      return note;
    } catch (err) {
      if (err.statusCode === 400) { reply.code(400); return { error: err.message }; }
      if (err.code === '23514') { reply.code(400); return { error: 'Exactly one of account_id, contact_id, opportunity_id must be set.' }; }
      if (err.code === '23503') { reply.code(404); return { error: 'Referenced account/contact/opportunity not found.' }; }
      throw err;
    }
  });

  fastify.patch('/notes/:id', {
    schema: {
      description: 'Update a note body. Target entity cannot be changed.',
      tags: ['notes'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: { body: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const note = await notesService.patch(request.userId, request.params.id, request.body);
    if (!note) { reply.code(404); return { error: 'Note not found' }; }
    return note;
  });

  fastify.delete('/notes/:id', {
    schema: {
      description: 'Delete a note.',
      tags: ['notes'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const deleted = await notesService.delete(request.userId, request.params.id);
    if (!deleted) { reply.code(404); return { error: 'Note not found' }; }
    return { deleted: true, id: deleted.id };
  });
}
