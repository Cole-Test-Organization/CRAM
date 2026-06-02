import { withUser } from '../../db/connection.js';

export default async function healthRoutes(fastify) {
  fastify.get('/health', {
    schema: {
      description: 'Health check with database stats scoped to the current user. The `accounts` count excludes partners (it represents companies the user sells to). Partner counts are in `partners`.',
      tags: ['health'],
    },
  }, async (request) => {
    const counts = await withUser(request.userId, async (client) => {
      const rows = (await client.query(`
        SELECT
          (SELECT COUNT(*)::int FROM accounts
             WHERE status IS NULL OR LOWER(status) <> 'partner') AS accounts,
          (SELECT COUNT(*)::int FROM accounts
             WHERE LOWER(status) = 'partner') AS partners,
          (SELECT COUNT(*)::int FROM contacts) AS contacts,
          (SELECT COUNT(*)::int FROM meetings) AS meetings,
          (SELECT COUNT(*)::int FROM meetings WHERE internal = true) AS internal,
          (SELECT COUNT(*)::int FROM opportunities) AS opportunities
      `)).rows;
      return rows[0];
    });

    return {
      status: 'ok',
      counts,
      uptime: process.uptime(),
    };
  });
}
