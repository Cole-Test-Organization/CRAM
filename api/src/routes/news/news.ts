import type { FastifyInstance } from 'fastify';
import type { NewsService } from '../../services/news/news.js';

// Per-account news headlines (Google News RSS, LLM-ranked) plus the ranking-prompt
// settings (global per-user, with an optional per-account override). Refresh is
// async: POST returns 202 and the client polls GET until status settles.
export default async function newsRoutes(
  fastify: FastifyInstance,
  { newsService }: { newsService: NewsService },
) {
  fastify.get<{ Params: { id: number } }>('/accounts/:id/news', {
    schema: {
      description:
        'Get the stored, LLM-ranked news headlines for an account plus the last-refresh status and this account\'s ranking-prompt override. Read-only — does NOT fetch. Trigger a fetch with POST /accounts/:id/news/refresh. status is one of null (never fetched), "refreshing", "ok", "error".',
      tags: ['news'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const news = await newsService.getNews(request.userId, request.params.id);
    if (!news) { reply.code(404); return { error: 'Account not found' }; }
    return news;
  });

  fastify.post<{ Params: { id: number } }>('/accounts/:id/news/refresh', {
    schema: {
      description:
        'Fetch fresh Google News headlines for the account\'s company name and re-rank them with the configured local LLM. Async: returns 202 with status "refreshing" immediately (the local LLM can take 10-30s); poll GET /accounts/:id/news until status is "ok" or "error".',
      tags: ['news'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const result = await newsService.startRefresh(request.userId, request.params.id);
    if (!result) { reply.code(404); return { error: 'Account not found' }; }
    reply.code(202);
    return result;
  });

  fastify.patch<{ Params: { id: number }; Body: { ranking_prompt?: string | null } }>('/accounts/:id/news', {
    schema: {
      description:
        'Set or clear this account\'s news-ranking prompt override. Pass null or an empty string to fall back to the global ranking prompt. Returns the account\'s news payload (same shape as GET).',
      tags: ['news'],
      params: { type: 'object', properties: { id: { type: 'integer' } } },
      body: {
        type: 'object',
        properties: { ranking_prompt: { type: ['string', 'null'] } },
      },
    },
  }, async (request, reply) => {
    const news = await newsService.updateAccountSettings(request.userId, request.params.id, request.body || {});
    if (!news) { reply.code(404); return { error: 'Account not found' }; }
    return news;
  });

  fastify.get('/news/settings', {
    schema: {
      description:
        'Get the user\'s global news-ranking prompt. ranking_prompt is null when the user hasn\'t customized it (the built-in default, also returned as default_ranking_prompt, applies).',
      tags: ['news'],
    },
  }, async (request) => {
    return newsService.getSettings(request.userId);
  });

  fastify.patch<{ Body: { ranking_prompt?: string | null } }>('/news/settings', {
    schema: {
      description:
        'Set or clear the global news-ranking prompt. Pass null or an empty string to revert to the built-in default.',
      tags: ['news'],
      body: {
        type: 'object',
        properties: { ranking_prompt: { type: ['string', 'null'] } },
      },
    },
  }, async (request) => {
    return newsService.updateSettings(request.userId, request.body || {});
  });
}
