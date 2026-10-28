// Krisp webhook — end-to-end over HTTP with the REAL captured payload.
//
// Drives the actual production entry point — POST /api/krisp-webhook (route →
// auth → KrispWebhookService) — with the verbatim shape Krisp sends
// (fixtures/krisp-webhook-payloads.js). The suite's API boots with Gmail blanked
// out (dev/scripts/test/run-api-tests.js), so no mail is ever sent: a notes
// delivery gets the "not configured" 503 (the send itself is covered with a fake
// transport in krisp-webhook.test.js), transcript / outline deliveries are
// acknowledged, and nothing is written to the CRM.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { get, post, listFrom } from './helpers.js';
import { krispWebhookPayload } from './fixtures/krisp-webhook-payloads.js';

describe('Krisp webhook — end-to-end over HTTP with the real captured payload', () => {
  it('refuses a notes delivery with a 503 naming the missing Gmail config', async () => {
    const res = await post('/krisp-webhook', krispWebhookPayload());
    assert.equal(res.status, 503, JSON.stringify(res.body));
    assert.match(res.body.error, /GMAIL_USER/);
  });

  it('acknowledges transcript and outline deliveries without emailing', async () => {
    for (const event of ['transcript_generated', 'outline_generated']) {
      const res = await post('/krisp-webhook', krispWebhookPayload({ event }));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.outcome, 'ignored');
      assert.equal(res.body.event, event.replace('_generated', ''));
      assert.equal(res.body.krisp_meeting_id, '019ec3606cdd735f912ac170db9e392a', 'meeting id, not the event id');
    }
  });

  it('writes nothing to the CRM', async () => {
    // The old importer parked unmatched notes as new meetings; with a far-future
    // start, such a row would sort to the top of the date-desc meetings list.
    const title = `zzz krisp e2e ${Date.now()}`;
    const times = { start: '2031-07-01T15:00:00.000Z', end: '2031-07-01T15:30:00.000Z' };
    await post('/krisp-webhook', krispWebhookPayload({ title, ...times }));
    await post('/krisp-webhook', krispWebhookPayload({ title, event: 'transcript_generated', ...times }));

    const res = await get('/meetings?limit=20');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(!listFrom(res.body).some((m) => m.title === title), 'no meeting was created');
  });
});
