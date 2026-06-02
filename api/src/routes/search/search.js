export default async function searchRoutes(fastify, { searchService }) {
  fastify.get('/search', {
    schema: {
      description: 'Full-text search across all data. Use to find mentions of a product, person, or topic across all accounts and meetings.',
      tags: ['search'],
      querystring: {
        type: 'object',
        required: ['q'],
        properties: {
          q: { type: 'string', description: 'Search query' },
          type: { type: 'string', enum: ['all', 'accounts', 'contacts', 'meetings', 'internal'], default: 'all', description: 'Limit search to a specific type' },
          limit: { type: 'integer', default: 20, minimum: 1, maximum: 100, description: 'Max results per type' },
        },
      },
    },
  }, async (request) => {
    const { q, type, limit } = request.query;
    return searchService.search(request.userId, q, { type, limit });
  });
}
