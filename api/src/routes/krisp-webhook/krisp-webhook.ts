// Krisp webhook HTTP surface — POST /api/krisp-webhook.
//
// Krisp POSTs when a meeting's notes / transcript / outline are generated. The
// notes get emailed to you through Gmail; transcript and outline deliveries are
// acknowledged and ignored. Nothing is written to the CRM. See
// KrispWebhookService and krisp/README.md.
//
// Deterministic, HTTP-only (not agent/MCP-callable) — see the krisp-webhook
// exception in CLAUDE.md.
//
// Auth: set KRISP_WEBHOOK_TOKEN and have Krisp send a matching
// "Authorization: <token>" or "x-krisp-webhook-token: <token>" header (Krisp
// supports custom request headers). Unset ⇒ accepts anything (ngrok test) — and
// since every accepted notes delivery sends an email, set it before going live.
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
      description: 'Receive a Krisp webhook delivery (notes / transcript / outline generated). A notes delivery is emailed through Gmail SMTP to KRISP_EMAIL_TO (default GMAIL_USER) with subject "Krisp notes: <title> (<date>)", the date rendered in KRISP_EMAIL_TZ (default America/New_York); transcript and outline deliveries are acknowledged with outcome "ignored", so each meeting sends one email. Nothing is written to the CRM, and a re-sent event emails again. 503 when GMAIL_USER / GMAIL_APP_PASSWORD are not set; 502 when Gmail rejects the login or cannot be reached. Send the token as the Authorization or x-krisp-webhook-token header if KRISP_WEBHOOK_TOKEN is set.',
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

    // Log the raw delivery first, before sending, so the exact shape is captured
    // even if the email fails.
    logger.info({ event: 'krisp_webhook.received', body: request.body }, 'krisp webhook received');

    try {
      return await krispWebhookService.ingest(request.body);
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      logger.error({ event: 'krisp_webhook.failed', err: e.message }, 'krisp webhook failed');
      if (e.statusCode) { reply.code(e.statusCode); return { error: e.message }; }
      throw err;
    }
  });
}
