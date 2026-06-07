// HTTP routes for the themes resource — list/get/create/update/delete plus
// the per-user active-theme pointer (get_active, set_active).
import type { FastifyInstance } from 'fastify';
import type { ThemesService } from '../../services/themes/themes.js';

const themeSchema = {
  type: 'object',
  properties: {
    id:          { type: 'integer' },
    user_id:     { type: ['integer', 'null'] },
    slug:        { type: 'string' },
    name:        { type: 'string' },
    description: { type: ['string', 'null'] },
    theme_data:  { type: 'object', additionalProperties: true },
    is_builtin:  { type: 'boolean' },
    created_at:  { type: 'string' },
    updated_at:  { type: 'string' },
  },
};

export default async function themesRoutes(fastify: FastifyInstance, { themesService }: { themesService: ThemesService }) {
  fastify.get('/themes', {
    schema: {
      description: 'List themes visible to the caller: all built-in themes plus the caller\'s own custom themes. Built-ins are returned first, then alphabetically by name.',
      tags: ['themes'],
      response: {
        200: {
          type: 'object',
          properties: {
            themes: { type: 'array', items: themeSchema },
          },
        },
      },
    },
  }, async (request) => themesService.list(request.userId));

  fastify.get('/themes/active', {
    schema: {
      description: 'Get the caller\'s active theme. Returns { active_theme_id, theme } — `theme` is the full row, or the default built-in if the user hasn\'t picked one yet.',
      tags: ['themes'],
      response: {
        200: {
          type: 'object',
          properties: {
            active_theme_id: { type: ['integer', 'null'] },
            theme:           themeSchema,
          },
        },
      },
    },
  }, async (request) => themesService.getActive(request.userId));

  fastify.post<{ Body: { theme_id?: number | null } }>('/themes/active', {
    schema: {
      description: 'Set the caller\'s active theme. Pass { theme_id: <id> } where the id refers to either a built-in or one of the user\'s own themes. Pass theme_id: null to clear (falls back to the default built-in on next read).',
      tags: ['themes'],
      body: {
        type: 'object',
        properties: {
          theme_id: { type: ['integer', 'null'] },
        },
      },
    },
  }, async (request, reply) => {
    try {
      return await themesService.setActive(request.userId, request.body?.theme_id ?? null);
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode) return reply.code(e.statusCode).send({ error: e.message });
      throw err;
    }
  });

  fastify.get<{ Params: { id: number } }>('/themes/:id', {
    schema: {
      description: 'Get a single theme by id. Built-ins are visible to all users; user themes are visible only to their owner.',
      tags: ['themes'],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
      response: { 200: themeSchema },
    },
  }, async (request, reply) => {
    try {
      return await themesService.get(request.userId, request.params.id);
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode) return reply.code(e.statusCode).send({ error: e.message });
      throw err;
    }
  });

  fastify.post<{ Body: { slug: string; name: string; description?: string | null; theme_data: Record<string, unknown> } }>('/themes', {
    schema: {
      description: 'Create a new user theme. theme_data must contain `colors` (six ramps of 11 hex strings: surf, cerulean, amber, papaya, scarlet, base — index 0 = the text-end, index 10 = the background-end). Optional: fonts {sans, mono, display}, effects {scanline_color, scanline_spacing, highlight_mark_color}.',
      tags: ['themes'],
      body: {
        type: 'object',
        required: ['slug', 'name', 'theme_data'],
        properties: {
          slug:        { type: 'string' },
          name:        { type: 'string' },
          description: { type: ['string', 'null'] },
          theme_data:  { type: 'object', additionalProperties: true },
        },
      },
      response: { 200: themeSchema },
    },
  }, async (request, reply) => {
    try {
      return await themesService.create(request.userId, request.body);
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode) return reply.code(e.statusCode).send({ error: e.message });
      throw err;
    }
  });

  fastify.patch<{ Params: { id: number }; Body: { slug?: string; name?: string; description?: string | null; theme_data?: Record<string, unknown> } }>('/themes/:id', {
    schema: {
      description: 'Update one of the caller\'s themes. Pass any subset of { slug, name, description, theme_data }. Built-in themes are read-only — duplicate first if you want to modify them.',
      tags: ['themes'],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: {
          slug:        { type: 'string' },
          name:        { type: 'string' },
          description: { type: ['string', 'null'] },
          theme_data:  { type: 'object', additionalProperties: true },
        },
      },
      response: { 200: themeSchema },
    },
  }, async (request, reply) => {
    try {
      return await themesService.update(request.userId, request.params.id, request.body);
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode) return reply.code(e.statusCode).send({ error: e.message });
      throw err;
    }
  });

  fastify.delete<{ Params: { id: number } }>('/themes/:id', {
    schema: {
      description: 'Delete one of the caller\'s themes. Built-in themes cannot be deleted. If the deleted theme was active, the user falls back to the default built-in on next read (FK is ON DELETE SET NULL).',
      tags: ['themes'],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    try {
      return await themesService.delete(request.userId, request.params.id);
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode) return reply.code(e.statusCode).send({ error: e.message });
      throw err;
    }
  });
}
