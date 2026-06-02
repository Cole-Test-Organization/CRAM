export default async function todoistRoutes(fastify, { todoistService }) {
  // Create single task
  fastify.post('/todoist/tasks', {
    schema: {
      description: 'Create a single Todoist task. Defaults to Jobs > Palo section.',
      tags: ['todoist'],
      body: {
        type: 'object',
        required: ['content'],
        properties: {
          content: { type: 'string', description: 'Task description' },
          description: { type: 'string', description: 'Additional context' },
          labels: { type: 'array', items: { type: 'string' }, description: 'Labels (e.g., account slug)' },
          due_string: { type: 'string', description: 'Natural language due date (e.g., "next Friday")' },
          due_date: { type: 'string', description: 'Specific due date (YYYY-MM-DD)' },
          priority: { type: 'integer', minimum: 1, maximum: 4, description: '1=normal, 4=urgent' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const task = await todoistService.createTask(request.body);
      reply.code(201);
      return task;
    } catch (err) {
      reply.code(502);
      return { error: `Todoist API error: ${err.message}` };
    }
  });

  // Batch create tasks
  fastify.post('/todoist/tasks/batch', {
    schema: {
      description: 'Create multiple Todoist tasks at once.',
      tags: ['todoist'],
      body: {
        type: 'object',
        required: ['tasks'],
        properties: {
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              required: ['content'],
              properties: {
                content: { type: 'string' },
                description: { type: 'string' },
                labels: { type: 'array', items: { type: 'string' } },
                due_string: { type: 'string' },
                due_date: { type: 'string' },
                priority: { type: 'integer', minimum: 1, maximum: 4 },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const results = await todoistService.createTasksBatch(request.body.tasks);
      reply.code(201);
      return { created: results.length, tasks: results };
    } catch (err) {
      reply.code(502);
      return { error: `Todoist API error: ${err.message}` };
    }
  });

  // List tasks
  fastify.get('/todoist/tasks', {
    schema: {
      description: 'List Todoist tasks. Filter by label or custom filter.',
      tags: ['todoist'],
      querystring: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Filter by label name' },
          filter: { type: 'string', description: 'Todoist filter query' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      return await todoistService.getTasks(request.query);
    } catch (err) {
      reply.code(502);
      return { error: `Todoist API error: ${err.message}` };
    }
  });

  // Close task
  fastify.post('/todoist/tasks/:id/close', {
    schema: {
      description: 'Close (complete) a Todoist task.',
      tags: ['todoist'],
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (request, reply) => {
    try {
      return await todoistService.closeTask(request.params.id);
    } catch (err) {
      reply.code(502);
      return { error: `Todoist API error: ${err.message}` };
    }
  });
}
