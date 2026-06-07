// Ambient Fastify augmentations for this app's request/instance shape.
// Included via tsconfig's `src/**/*`; the `import type` makes this a module so
// `declare module 'fastify'` augments (rather than replaces) the Fastify types.
import type { SearchService } from '../services/search/search.js';

declare module 'fastify' {
  interface FastifyRequest {
    // Attached by the global preHandler hook in index.ts (stubbed to the
    // default user until real auth lands). Always present inside route handlers.
    userId: number;
  }
  interface FastifyInstance {
    // Decorated in index.ts; read by the search route.
    searchService: SearchService;
  }
}
