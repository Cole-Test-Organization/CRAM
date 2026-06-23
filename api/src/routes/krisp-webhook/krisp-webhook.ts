// Krisp webhook HTTP surface — POST /api/krisp-webhook.
//
// Krisp POSTs when a meeting's notes / transcript / outline are generated. The
// importer matches the meeting that already exists (calendar-import made it) by
// time proximity and appends the notes, or parks a new meeting for review when
// there's no confident match. See KrispWebhookService and krisp/README.md.
//
// Deterministic, HTTP-only (not agent/MCP-callable) — see the krisp-webhook
// exception in CLAUDE.md.
//
// Auth: no app-level auth yet. Behind a Cloudflare tunnel, CF Access is the real
// gate; Krisp can also send arbitrary request headers, so as a simple app-level
// check set KRISP_WEBHOOK_TOKEN and send a matching "Authorization: <token>" or
// "x-krisp-webhook-token: <token>" header. Unset ⇒ accepts anything (ngrok test).
//
// The raw body is logged (event "krisp_webhook.received") on every delivery so we
// can keep refining against real payloads.

import type { FastifyInstance } from 'fastify';
import type { KrispWebhookService } from '../../services/krisp-webhook/krisp-webhook.js';
import { logger as rootLogger } from '../../lib/logger.js';

const logger = rootLogger.child({ component: 'krisp-webhook' });

const BODY_LIMIT = Number(process.env.KRISP_WEBHOOK_BODY_LIMIT) || 16 * 1024 * 1024; // 16MB — transcripts can be large

export default async function krispWebhookRoutes(fastify: FastifyInstance, { krispWebhookService }: { krispWebhookService: KrispWebhookService }) {
  const expectedToken = process.env.KRISP_WEBHOOK_TOKEN || null;

  fastify.post<{ Body: unknown }>('/krisp-webhook', {
    bodyLimit: BODY_LIMIT,
    schema: {
      description: 'Receive a Krisp webhook delivery (notes / transcript / outline generated) and import the notes into the CRM. Matches the meeting that already exists by time proximity (±KRISP_MATCH_WINDOW_MIN, default 10 min, of the meeting start; overlap breaks ties) and appends the notes (flagging needs_review to verify); with no confident match it parks a new meeting for review. Idempotent on the Krisp meeting id. Send the token as the Authorization or x-krisp-webhook-token header if KRISP_WEBHOOK_TOKEN is set.',
      tags: ['krisp-webhook'],
      body: { type: 'object', additionalProperties: true },
    },
  }, async (request, reply) => {
    if (expectedToken) {
      const custom = request.headers['x-krisp-webhook-token'];
      const auth = typeof request.headers['authorization'] === 'string'
        ? request.headers['authorization'].replace(/^Bearer\s+/i, '')
        : null;
      if (custom !== expectedToken && auth !== expectedToken) {
        reply.code(401);
        return { error: 'Missing or invalid Krisp webhook token.' };
      }
    }

    // Log the raw delivery first, before import, so the exact shape is captured
    // even if the import errors.
    logger.info({ event: 'krisp_webhook.received', body: request.body }, 'krisp webhook received');

    try {
      return await krispWebhookService.ingest(request.userId, request.body);
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      logger.error({ event: 'krisp_webhook.failed', err: e.message }, 'krisp webhook import failed');
      if (e.statusCode) { reply.code(e.statusCode); return { error: e.message }; }
      throw err;
    }
  });
}
