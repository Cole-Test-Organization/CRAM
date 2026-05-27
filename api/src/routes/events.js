// Events routes. The events table is global (one row visible to every user),
// so list/get handlers do not pass request.userId to the service. The
// upcoming/with-contacts endpoint is the only one that scopes to the caller —
// it joins the global events to that user's contacts. Designed so a public,
// unauthenticated mount of /events is a one-line lift if we ever want to
// expose the calendar externally.

export default async function eventRoutes(fastify, { eventsService }) {
  fastify.get('/events', {
    schema: {
      description: 'List events with optional filters. Global data — same rows for every user. Returns { events: [...], total: int } where total is the unpaginated count.',
      tags: ['events'],
      querystring: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'Case-insensitive exact match' },
          country: { type: 'string', description: 'Case-insensitive exact match' },
          mode: { type: 'string', enum: ['in_person', 'virtual', 'hybrid', 'on_demand'] },
          source: { type: 'string', description: 'Scraper source (e.g., paloaltonetworks)' },
          after: { type: 'string', description: 'ISO date — only events starting on/after' },
          before: { type: 'string', description: 'ISO date — only events starting on/before' },
          has_location: { type: 'boolean', description: 'Only events with a normalized city' },
          search: { type: 'string', description: 'ILIKE match against title, summary, and location_raw' },
          tags: { type: 'string', description: 'Comma-separated tag list — matches events with ANY of the supplied tags' },
          sort: { type: 'string', enum: ['start_date', 'end_date', 'title', 'created_at', 'updated_at'], default: 'start_date' },
          order: { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
          limit: { type: 'integer', default: 200 },
          offset: { type: 'integer', default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    try {
      return await eventsService.list(request.query);
    } catch (err) {
      if (err.statusCode === 400) { reply.code(400); return { error: err.message }; }
      throw err;
    }
  });

  fastify.get('/events/facets', {
    schema: {
      description: 'Distinct filter values with counts, for populating frontend dropdowns. Returns { cities, countries, modes, sources, tags } where each is an array of { value, count } sorted by count desc.',
      tags: ['events'],
    },
  }, async () => {
    return eventsService.getFacets();
  });

  fastify.get('/events/upcoming/with-contacts', {
    schema: {
      description: 'Upcoming in-person events alongside the caller\'s contacts that live in the same city. The only events endpoint that scopes to the authenticated user.',
      tags: ['events'],
      querystring: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['in_person', 'virtual', 'hybrid', 'on_demand'], default: 'in_person' },
          after: { type: 'string', description: 'ISO date — defaults to today' },
          before: { type: 'string', description: 'ISO date' },
          limit: { type: 'integer', default: 100 },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const events = await eventsService.upcomingWithMatchedContacts(request.userId, request.query);
      return { events };
    } catch (err) {
      if (err.statusCode === 400) { reply.code(400); return { error: err.message }; }
      throw err;
    }
  });

  fastify.get('/events/:id', {
    schema: {
      description: 'Get a single event by ID.',
      tags: ['events'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const event = await eventsService.getById(request.params.id);
    if (!event) { reply.code(404); return { error: 'Event not found' }; }
    return event;
  });

  fastify.post('/events', {
    schema: {
      description: 'Upsert an event by (source, source_id). Used by the scraper; safe to call repeatedly.',
      tags: ['events'],
      body: {
        type: 'object',
        required: ['source', 'source_id', 'title'],
        properties: {
          source: { type: 'string', description: 'Scraper identifier, e.g., paloaltonetworks' },
          source_id: { type: 'string', description: 'Stable identifier from the source (URL hash, slug)' },
          title: { type: 'string' },
          summary: { type: ['string', 'null'] },
          start_date: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
          end_date: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
          mode: { type: ['string', 'null'], enum: ['in_person', 'virtual', 'hybrid', 'on_demand', null] },
          location_raw: { type: ['string', 'null'] },
          city: { type: ['string', 'null'] },
          state: { type: ['string', 'null'] },
          country: { type: ['string', 'null'] },
          venue: { type: ['string', 'null'] },
          url: { type: ['string', 'null'] },
          tags: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const event = await eventsService.upsert(request.body);
      reply.code(200);
      return event;
    } catch (err) {
      if (err.statusCode === 400) { reply.code(400); return { error: err.message }; }
      throw err;
    }
  });

  fastify.delete('/events/:id', {
    schema: {
      description: 'Delete an event.',
      tags: ['events'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const deleted = await eventsService.delete(request.params.id);
    if (!deleted) { reply.code(404); return { error: 'Event not found' }; }
    return { deleted: true, title: deleted.title };
  });
}
