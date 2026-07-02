// Krisp webhook — full end-to-end over HTTP with the REAL captured payload.
//
// The analog of notes-import-google-drive-zip.test.js: instead of hand-built
// objects, this drives the actual production entry point — POST /api/krisp-webhook
// (route → auth → KrispWebhookService → DB) — with the verbatim shape Krisp sends
// (fixtures/krisp-webhook-payloads.js), then reads the result back over HTTP.
// Proves the whole path works against a real delivery, including that we ignore
// the emails/calendar_event_id Krisp includes. Created meetings are deleted after.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { get, post, del } from './helpers.js';
import { closeDb } from '../src/db/connection.js';
import { krispWebhookPayload } from './fixtures/krisp-webhook-payloads.js';

const createdMeetingIds = new Set();

after(async () => {
  for (const id of createdMeetingIds) {
    try { await del(`/meetings/${id}`); } catch { /* best effort */ }
  }
  await closeDb();
});

describe('Krisp webhook — end-to-end over HTTP with the real captured payload', () => {
  it('imports a real note_generated delivery (parks it) and folds a follow-up transcript into the same meeting', async () => {
    // Unique meeting id + far-future start so it can't time-match a seeded
    // meeting → it parks. (The real payload's start is 2026; we override it.)
    const meetingId = `zzz_krisp_e2e_${Date.now()}`;
    const note = krispWebhookPayload({
      eventId: `evt-note-${meetingId}`, meetingId,
      start: '2031-07-01T15:00:00.000Z', end: '2031-07-01T15:01:15.000Z',
    });

    const res = await post('/krisp-webhook', note);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.outcome, 'created', JSON.stringify(res.body));
    assert.equal(res.body.event, 'note');
    assert.ok(res.body.meeting_id, 'created a meeting');
    createdMeetingIds.add(res.body.meeting_id);

    // The meeting carries Krisp's pre-rendered notes verbatim + the krisp link,
    // and is parked for review. No account/contacts came from the emails.
    const meeting = (await get(`/meetings/${res.body.meeting_id}`)).body;
    assert.equal(meeting.internal, true);
    assert.equal(meeting.needs_review, true);
    assert.equal(meeting.review_reason, 'krisp_no_match');
    assert.equal(meeting.account_id, null, 'no account resolved from participant emails');
    assert.equal(meeting.krisp_meeting_id, meetingId);
    assert.match(meeting.body, /## Action Items/);
    assert.match(meeting.body, /Krisp overview/);
    assert.ok(!meeting.attendees, 'participant emails were ignored, not imported as attendees');

    // The transcript event for the SAME Krisp meeting folds into the same row.
    const transcript = krispWebhookPayload({
      eventId: `evt-tx-${meetingId}`, meetingId, event: 'transcript_generated',
      start: '2031-07-01T15:00:00.000Z', end: '2031-07-01T15:01:15.000Z',
      rawContent: 'Bob: Welcome everyone.\nAnna: Thanks for having me!',
    });
    const res2 = await post('/krisp-webhook', transcript);
    assert.equal(res2.status, 200, JSON.stringify(res2.body));
    assert.equal(res2.body.meeting_id, res.body.meeting_id, 'same meeting, no duplicate');
    assert.equal(res2.body.outcome, 'updated');

    const after2 = (await get(`/meetings/${res.body.meeting_id}`)).body;
    assert.match(after2.body, /## Action Items/, 'original notes kept');
    assert.match(after2.body, /Bob: Welcome everyone\./, 'transcript appended');
    assert.match(after2.body, /<!-- krisp:transcript -->/);

    // Re-delivering the same note event is a no-op (marker already present).
    const dupe = await post('/krisp-webhook', note);
    assert.equal(dupe.status, 200, JSON.stringify(dupe.body));
    assert.equal(dupe.body.outcome, 'noop', JSON.stringify(dupe.body));
  });

  it('time-matches and appends onto an existing meeting whose start is within the window', async () => {
    // An existing CRM meeting (stand-in for a calendar import), far-future internal.
    const created = (await post('/meetings', {
      date: '2031-08-15', starts_at: '2031-08-15T18:00:00.000Z', ends_at: '2031-08-15T19:00:00.000Z',
      title: 'ZZZ Krisp E2E Existing', body: 'Original agenda.', internal: true,
    })).body;
    assert.ok(created.id, JSON.stringify(created));
    createdMeetingIds.add(created.id);

    // Krisp meeting started 4 min later and ran short → matches on START.
    const kid = `zzz_krisp_e2e_match_${Date.now()}`;
    const res = await post('/krisp-webhook', krispWebhookPayload({
      eventId: `evt-${kid}`, meetingId: kid,
      start: '2031-08-15T18:04:00.000Z', end: '2031-08-15T18:40:00.000Z',
    }));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.outcome, 'matched', JSON.stringify(res.body));
    assert.equal(res.body.meeting_id, created.id, 'appended onto the existing meeting, no new row');

    const merged = (await get(`/meetings/${created.id}`)).body;
    assert.match(merged.body, /Original agenda\./, 'existing notes kept');
    assert.match(merged.body, /## Action Items/, 'krisp notes appended');
    assert.equal(merged.krisp_meeting_id, kid, 'krisp id linked onto the matched meeting');
    assert.equal(merged.needs_review, false, 'single time-match appends cleanly');
    assert.equal(merged.review_reason, null);
  });
});
