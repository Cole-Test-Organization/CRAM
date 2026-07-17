import type { FastifyInstance } from 'fastify';
import type { AgentSettingsService } from '../../services/agent/agent-settings.js';
import type { MemoriesService } from '../../services/memories/memories.js';
import { buildAgentMarkdown } from '../../instructions.js';
import {
  listSessions,
  loadSession,
  deleteSession,
} from '../../services/agent/agent-sessions.js';
import { runAgent } from '../../agent/loop.js';

export default async function agentRoutes(fastify: FastifyInstance, { agentSettingsService, memoriesService }: { agentSettingsService: AgentSettingsService; memoriesService: MemoriesService }) {
  fastify.get('/agent', {
    schema: {
      description: 'Returns a markdown reference for LLM agents: workflows, when-to-use guidance, the caller\'s active memories, and pointers to schemas (which live in /docs). MCP clients get the same content (with tool-call syntax) automatically in the initialize handshake (InitializeResult.instructions).',
      tags: ['agent'],
      produces: ['text/markdown'],
      response: {
        200: { type: 'string' },
      },
    },
  }, async (request, reply) => {
    const baseUrl = process.env.API_BASE_URL || 'http://localhost';
    let memories: any[] = [];
    try {
      memories = await memoriesService.listEnabledForInjection(request.userId);
    } catch {
      memories = [];
    }
    reply.type('text/markdown').send(buildAgentMarkdown({ baseUrl, mode: 'http', memories }));
  });

  fastify.post<{ Body: { prompt: string; notes?: string; sessionId?: string; provider?: string; model?: string; localBaseUrl?: string; allowedTools?: string[]; mentions?: any[] } }>('/agent/query', {
    schema: {
      description: 'Run a prompt through the in-process agent loop and stream events as Server-Sent Events. Tool calls are routed through the in-memory CRM MCP client automatically. Pass sessionId to continue a multi-turn conversation; pass provider/model to override the configured defaults.',
      tags: ['agent'],
      body: {
        type: 'object',
        required: ['prompt'],
        properties: {
          prompt: { type: 'string', minLength: 1 },
          notes: { type: 'string' },
          sessionId: { type: 'string' },
          provider: { type: 'string' },
          model: { type: 'string' },
          localBaseUrl: { type: 'string', description: 'Per-request override for the local provider\'s base URL. Falls back to LOCAL_BASE_URL env if absent.' },
          allowedTools: {
            type: 'array',
            items: { type: 'string' },
            description: 'Restrict MCP tools the model sees on this turn. Omit for all tools; pass [] to cut tools off entirely (text-only answer); pass a list of tool names to expose only those.',
          },
          mentions: {
            type: 'array',
            description: 'Records the user @-tagged in the prompt. The server resolves each to a compact identity card appended to the message, so the agent gets the exact id without having to search for it.',
            items: {
              type: 'object',
              required: ['type', 'id'],
              properties: {
                type: { type: 'string', enum: ['account', 'partner', 'contact', 'meeting', 'opportunity'] },
                id: { type: 'integer' },
                label: { type: 'string' },
                slug: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { prompt, notes, mentions, sessionId, allowedTools } = request.body;
    let { provider, model, localBaseUrl } = request.body;

    // Resolve the saved settings for every call. The request body may override
    // non-secret fields, but the bearer token is intentionally never accepted on
    // this query endpoint: it comes only from the encrypted per-user setting.
    const effective = await agentSettingsService.getEffective(request.userId);
    provider     = provider     || effective.provider;
    model        = model        || effective.model;
    localBaseUrl = localBaseUrl || effective.local_base_url || undefined;

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (event: any) => {
      if (!reply.raw.writableEnded) {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    };

    const abort = new AbortController();
    request.raw.on('close', () => abort.abort());

    try {
      await runAgent({
        userId: request.userId,
        prompt,
        notes,
        mentions,
        sessionId,
        provider,
        model,
        localBaseUrl,
        localApiKey: effective.local_api_key || undefined,
        allowedTools,
        send,
        signal: abort.signal,
      });
    } catch (err) {
      const e = err as { message?: string };
      fastify.log.error({ err }, 'agent run failed');
      send({ type: 'error', message: e?.message || String(err) });
    } finally {
      if (!reply.raw.writableEnded) reply.raw.end();
    }
  });

  fastify.get<{ Querystring: { limit?: number; search?: string } }>('/agent/sessions', {
    schema: {
      description: 'List past agent sessions for the authenticated user. Sorted most-recent first. Pass ?search=q to full-text search across titles and message contents — matches include a snippet. Pass ?limit=N to cap the number of returned sessions; total is always the unfiltered/filtered count.',
      tags: ['agent'],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 200 },
          search: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            total: { type: 'integer' },
            sessions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  title: { type: 'string' },
                  messageCount: { type: 'integer' },
                  createdAt: { type: 'string' },
                  updatedAt: { type: 'string' },
                  match: {
                    type: 'object',
                    properties: {
                      before: { type: 'string' },
                      match: { type: 'string' },
                      after: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  }, async (request) => {
    const { limit, search } = request.query;
    return listSessions(request.userId, { limit, search });
  });

  fastify.get<{ Params: { id: string } }>('/agent/sessions/:id', {
    schema: {
      description: 'Load a past agent session: returns the event stream (user prompts, assistant text, tool calls, tool results) reconstructed from stored messages. Use the returned id with POST /agent/query to continue the conversation.',
      tags: ['agent'],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    try {
      return await loadSession(request.userId, request.params.id);
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode) return reply.code(e.statusCode).send({ error: e.message });
      throw err;
    }
  });

  // Per-user agent provider config (provider, model, local server URL, and a
  // write-only encrypted bearer token).
  // Replaces the browser-localStorage state the GUI used to keep. Reading it
  // server-side lets background workers (contact enrichment, etc.) call the
  // same provider the user has configured for the in-app agent.
  fastify.get('/agent/settings', {
    schema: {
      description: 'Get the calling user\'s agent config: LLM fields (provider, model, local_base_url), whether an encrypted local-LLM bearer token is saved (`has_local_api_key`), and the agent\'s base `system_prompt`. The token itself is write-only and is never returned. Empty provider/URL fall through to defaults, which ship pointed at Ollama on the device itself. An empty model is resolved from the models the authenticated server actually exposes. `system_prompt` is null until the user customizes it; `default_system_prompt` is always the built-in default rendered live.',
      tags: ['agent'],
      response: {
        200: {
          type: 'object',
          properties: {
            provider:              { type: ['string', 'null'] },
            model:                 { type: ['string', 'null'] },
            local_base_url:        { type: ['string', 'null'] },
            has_local_api_key:     { type: 'boolean' },
            system_prompt:         { type: ['string', 'null'] },
            default_system_prompt: { type: 'string' },
            updated_at:            { type: ['string', 'null'] },
          },
        },
      },
    },
  }, async (request) => {
    return agentSettingsService.get(request.userId);
  });

  fastify.patch<{ Body: { provider?: string | null; model?: string | null; local_base_url?: string | null; local_api_key?: string | null; system_prompt?: string | null } }>('/agent/settings', {
    schema: {
      description: 'Update the agent config. Pass any subset of `provider`, `model`, `local_base_url`, write-only `local_api_key`, and `system_prompt`. `local_api_key` is encrypted with AES-256-GCM before it reaches Postgres and is sent as `Authorization: Bearer <token>` to the configured LLM; pass null/empty to remove it. The plaintext token is never returned. Provider must be local (an OpenAI-compatible inference server). local_base_url has its trailing slash stripped before storage. `system_prompt` is the agent\'s base instructions/persona — set it to customize, or null/empty to revert to the built-in default.',
      tags: ['agent'],
      body: {
        type: 'object',
        properties: {
          provider:       { type: ['string', 'null'], enum: ['local', null] },
          model:          { type: ['string', 'null'] },
          local_base_url: { type: ['string', 'null'] },
          local_api_key:  { type: ['string', 'null'], maxLength: 8192, description: 'Write-only bearer token value. A leading "Bearer " prefix is accepted and stripped. Omit to preserve the saved token; null/empty clears it.' },
          system_prompt:  { type: ['string', 'null'] },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    try {
      return await agentSettingsService.update(request.userId, request.body);
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode === 400) { reply.code(400); return { error: e.message }; }
      throw err;
    }
  });

  fastify.delete<{ Params: { id: string } }>('/agent/sessions/:id', {
    schema: {
      description: 'Delete a past agent session. Cannot be undone.',
      tags: ['agent'],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    try {
      await deleteSession(request.userId, request.params.id);
      return { ok: true };
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode) return reply.code(e.statusCode).send({ error: e.message });
      throw err;
    }
  });
}
