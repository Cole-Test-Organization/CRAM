// Krisp webhook → email — parse, env config, message building, and the
// send / ignore / error paths. Pure: the service gets an injected fake transport
// (or none), so nothing touches SMTP or the DB. The HTTP wiring is covered in
// krisp-webhook-e2e.test.js.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { KrispWebhookService, parseKrisp, buildEmail, emailConfigFromEnv } from '../src/services/krisp-webhook/krisp-webhook.js';
import { krispWebhookPayload } from './fixtures/krisp-webhook-payloads.js';

const CONFIG = { user: 'me@gmail.example', pass: 'abcdefghijklmnop', to: 'me@gmail.example', timeZone: 'America/New_York' };

// Records what would have been sent; `fail` rejects the way nodemailer does on a
// bad App Password.
function fakeTransport({ fail = false } = {}) {
  const sent = [];
  return {
    sent,
    async sendMail(message) {
      if (fail) throw Object.assign(new Error('Invalid login: 535-5.7.8 Username and Password not accepted'), { code: 'EAUTH' });
      sent.push(message);
      return { messageId: `<fake-${sent.length}@test>` };
    },
  };
}

describe('Krisp webhook — parse', () => {
  it('pulls event, the MEETING id (not the event id), title, times, url, and raw_content', () => {
    const p = parseKrisp(krispWebhookPayload({
      eventId: 'event-xyz', meetingId: 'meeting-abc', title: 'Acme sync',
      start: '2026-06-12T15:00:00.000Z', end: '2026-06-12T15:30:00.000Z',
    }));
    assert.equal(p.eventType, 'note');
    assert.equal(p.krispMeetingId, 'meeting-abc');
    assert.equal(p.title, 'Acme sync');
    assert.equal(p.startsAt, '2026-06-12T15:00:00.000Z');
    assert.equal(p.endsAt, '2026-06-12T15:30:00.000Z');
    assert.equal(p.url, 'https://app.krisp.ai/n/meeting-abc');
    assert.match(p.content, /## Action Items/);
  });

  it('canonicalizes event types and falls back to a JSON dump without raw_content', () => {
    assert.equal(parseKrisp({ event: 'transcript_generated', data: {} }).eventType, 'transcript');
    assert.equal(parseKrisp({ event: 'outline_generated', data: {} }).eventType, 'outline');
    assert.equal(parseKrisp({ event: 'brand_new_trigger', data: {} }).eventType, 'note', 'unknown triggers are emailed as notes');
    const p = parseKrisp({ event: 'note_generated', data: { meeting: { id: 'm1' }, sections: { foo: 1 } } });
    assert.match(p.content, /```json/);
  });
});

describe('Krisp webhook — email config from env', () => {
  it('strips the spaces Google shows in an App Password and defaults the recipient to the sender', () => {
    const c = emailConfigFromEnv({ GMAIL_USER: ' me@gmail.example ', GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop' });
    assert.deepEqual(c, { user: 'me@gmail.example', pass: 'abcdefghijklmnop', to: 'me@gmail.example', timeZone: 'America/New_York' });
  });

  it('honors KRISP_EMAIL_TO / KRISP_EMAIL_TZ and falls back from an invalid timezone', () => {
    const c = emailConfigFromEnv({ GMAIL_USER: 'me@gmail.example', GMAIL_APP_PASSWORD: 'x', KRISP_EMAIL_TO: 'notes@example.com', KRISP_EMAIL_TZ: 'America/Chicago' });
    assert.equal(c.to, 'notes@example.com');
    assert.equal(c.timeZone, 'America/Chicago');
    assert.equal(emailConfigFromEnv({ KRISP_EMAIL_TZ: 'Central' }).timeZone, 'America/New_York');
  });

  it('is unconfigured when the Gmail vars are unset', () => {
    assert.deepEqual(emailConfigFromEnv({}), { user: null, pass: null, to: null, timeZone: 'America/New_York' });
  });
});

describe('Krisp webhook — message', () => {
  it('puts the title and the LOCAL meeting date in the subject, so an evening meeting stays on its own day', () => {
    // 01:30Z on Jun 13 is 9:30 PM EDT on Jun 12.
    const p = parseKrisp(krispWebhookPayload({ meetingId: 'meeting-abc', title: 'Acme sync', start: '2026-06-13T01:30:00.000Z', end: '2026-06-13T02:00:00.000Z' }));
    const { subject, text } = buildEmail(p, 'America/New_York');
    assert.equal(subject, 'Krisp notes: Acme sync (Jun 12, 2026)');
    // \s: ICU separates "9:30" and "PM" with a narrow no-break space.
    assert.match(text, /^Acme sync\nStarted: Fri, Jun 12, 2026, 9:30\sPM EDT\nKrisp: https:\/\/app\.krisp\.ai\/n\/meeting-abc\n\n## Action Items/);
    assert.match(text, /## Key Points[\s\S]*## Outline/, 'Krisp notes included verbatim');
  });

  it('copes with a delivery that has no title or start time', () => {
    const { subject, text } = buildEmail(parseKrisp({ event: 'note_generated', data: { raw_content: 'Just notes.' } }), 'UTC');
    assert.equal(subject, 'Krisp notes: Untitled meeting');
    assert.equal(text, 'Untitled meeting\n\nJust notes.\n');
  });
});

describe('Krisp webhook — ingest', () => {
  it('emails a notes delivery from the Gmail account to the recipient', async () => {
    const transport = fakeTransport();
    const svc = new KrispWebhookService({ config: { ...CONFIG, to: 'notes@example.com' }, transport });
    const res = await svc.ingest(krispWebhookPayload({ meetingId: 'meeting-1', title: 'Acme sync', start: '2026-06-12T15:00:00.000Z' }));
    assert.deepEqual(res, { ok: true, event: 'note', krisp_meeting_id: 'meeting-1', outcome: 'emailed', message_id: '<fake-1@test>' });

    assert.equal(transport.sent.length, 1);
    const [mail] = transport.sent;
    assert.deepEqual(mail.from, { name: 'Krisp notes', address: 'me@gmail.example' });
    assert.equal(mail.to, 'notes@example.com');
    assert.equal(mail.subject, 'Krisp notes: Acme sync (Jun 12, 2026)');
    assert.match(mail.text, /## Action Items/);
  });

  it('acknowledges transcript and outline deliveries without sending', async () => {
    const transport = fakeTransport();
    const svc = new KrispWebhookService({ config: CONFIG, transport });
    for (const event of ['transcript_generated', 'outline_generated']) {
      const res = await svc.ingest(krispWebhookPayload({ event }));
      assert.equal(res.outcome, 'ignored', event);
    }
    assert.equal(transport.sent.length, 0);
  });

  it('is a 503 for a notes delivery when Gmail is not configured, but still acknowledges ignored events', async () => {
    const svc = new KrispWebhookService({ config: emailConfigFromEnv({}) });
    await assert.rejects(svc.ingest(krispWebhookPayload()), (err) => err.statusCode === 503 && /GMAIL_USER/.test(err.message));
    assert.equal((await svc.ingest(krispWebhookPayload({ event: 'transcript_generated' }))).outcome, 'ignored');
  });

  it("is a 502 carrying nodemailer's error code when Gmail rejects the send", async () => {
    const svc = new KrispWebhookService({ config: CONFIG, transport: fakeTransport({ fail: true }) });
    await assert.rejects(svc.ingest(krispWebhookPayload()), (err) => err.statusCode === 502 && /\(EAUTH\)/.test(err.message));
  });
});
