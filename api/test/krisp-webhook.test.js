// Krisp webhook importer — parse + idempotent fold + time-proximity match.
//
// Ignores emails entirely; keys first on the meeting's start time. The Krisp
// meeting id is only a fallback after a row has already been linked/parked, so
// retries and transcript/outline follow-ups do not duplicate. Drives the real
// KrispWebhookService against the seeded test DB (the pattern
// calendar-import-backfill.test.js uses) — no LLM, no network. Created
// meetings (incl. any tombstoned by a later test) are hard-deleted after.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AccountsService } from '../src/services/accounts/accounts.js';
import { ContactsService } from '../src/services/contacts/contacts.js';
import { MeetingsService } from '../src/services/meetings/meetings.js';
import { InternalDomainsService } from '../src/services/internal-domains/internal-domains.js';
import { KrispWebhookService, parseKrisp, pickMatch } from '../src/services/krisp-webhook/krisp-webhook.js';
import { getDefaultUserId } from '../src/auth.js';
import { withUser, closeDb } from '../src/db/connection.js';

let userId;
let meetingsService;
let svc;
const createdMeetingIds = new Set();

// Build a Krisp note_generated payload in the confirmed shape.
function krispNote({ id, title = 'ZZZ Krisp Test', start, end, event = 'note_generated', content = 'These are the notes.' }) {
  const meeting = { id, title };
  if (start) meeting.start_date = start;
  if (end) meeting.end_date = end;
  return { id: `evt-${id}-${event}`, event, data: { meeting, raw_content: content } };
}

describe('Krisp webhook — parse', () => {
  it('pulls event, the MEETING id (not the event id), title, times, and raw_content', () => {
    const p = parseKrisp({
      id: 'event-xyz',
      event: 'note_generated',
      data: { meeting: { id: 'meeting-abc', title: 'Acme sync', start_date: '2026-06-12T15:00:00.000Z', end_date: '2026-06-12T15:30:00.000Z' }, raw_content: '## Notes\n- hi' },
    });
    assert.equal(p.eventType, 'note');
    assert.equal(p.krispMeetingId, 'meeting-abc');
    assert.equal(p.title, 'Acme sync');
    assert.equal(p.startsAt, '2026-06-12T15:00:00.000Z');
    assert.equal(p.endsAt, '2026-06-12T15:30:00.000Z');
    assert.match(p.content, /## Notes/);
  });

  it('canonicalizes event types and falls back to a JSON dump without raw_content', () => {
    assert.equal(parseKrisp({ event: 'transcript_generated', data: {} }).eventType, 'transcript');
    assert.equal(parseKrisp({ event: 'outline_generated', data: {} }).eventType, 'outline');
    const p = parseKrisp({ event: 'note_generated', data: { meeting: { id: 'm1' }, sections: { foo: 1 } } });
    assert.match(p.content, /```json/);
  });
});

describe('Krisp webhook — pickMatch', () => {
  it('returns the only in-window candidate', () => {
    const c = [{ id: 1, starts_at: '2026-06-12T15:00:00Z', ends_at: '2026-06-12T16:00:00Z' }];
    assert.equal(pickMatch(c, new Date('2026-06-12T15:02:00Z').getTime(), null)?.id, 1);
  });
  it('breaks ties by largest overlap', () => {
    const c = [
      { id: 1, starts_at: '2026-06-12T15:00:00Z', ends_at: '2026-06-12T15:10:00Z' }, // tiny overlap
      { id: 2, starts_at: '2026-06-12T15:00:00Z', ends_at: '2026-06-12T16:00:00Z' }, // big overlap
    ];
    assert.equal(pickMatch(c, new Date('2026-06-12T15:00:00Z').getTime(), new Date('2026-06-12T15:45:00Z').getTime())?.id, 2);
  });
  it('is null (ambiguous) when two candidates are effectively tied', () => {
    // Two meetings at the same time → equal overlap, equal proximity → don't guess.
    const c = [
      { id: 1, starts_at: '2026-06-12T15:00:00Z', ends_at: '2026-06-12T16:00:00Z' },
      { id: 2, starts_at: '2026-06-12T15:00:00Z', ends_at: '2026-06-12T16:00:00Z' },
    ];
    assert.equal(pickMatch(c, new Date('2026-06-12T15:00:00Z').getTime(), new Date('2026-06-12T16:00:00Z').getTime()), null);
  });
});

describe('Krisp webhook — import (park / dedupe / append / time-match)', () => {
  before(async () => {
    userId = await getDefaultUserId();
    const accountsService = new AccountsService();
    const internalDomainsService = new InternalDomainsService();
    const contactsService = new ContactsService({ accountsService, internalDomainsService });
    meetingsService = new MeetingsService({ contactsService, accountsService, internalDomainsService });
    svc = new KrispWebhookService({ meetingsService });
  });

  after(async () => {
    // Hard-delete everything created (including merge/soft-delete tombstones).
    const ids = [...createdMeetingIds];
    if (ids.length) {
      await withUser(userId, async (client) => {
        await client.query('DELETE FROM meeting_attendees WHERE meeting_id = ANY($1::bigint[])', [ids]);
        await client.query('DELETE FROM meetings WHERE id = ANY($1::bigint[])', [ids]);
      });
    }
    await closeDb();
  });

  it('parks a new meeting when nothing matches, then dedupes and appends follow-up events', async () => {
    const kid = `zzz_krisp_${Date.now()}`;

    // No start time → no time-match → parks a new internal needs_review meeting.
    const first = await svc.ingest(userId, krispNote({ id: kid, content: 'Note body one.' }));
    assert.equal(first.outcome, 'created', JSON.stringify(first));
    assert.equal(first.needs_review, true);
    assert.ok(first.meeting_id);
    createdMeetingIds.add(first.meeting_id);

    const parked = await meetingsService.getById(userId, first.meeting_id);
    assert.equal(parked.internal, true);
    assert.equal(parked.krisp_meeting_id, kid);
    assert.match(parked.body, /Note body one\./);

    // Re-deliver the SAME event with no start time → no time-match is possible,
    // so the stored Krisp id acts as retry fallback and the marker makes it a no-op.
    const dupe = await svc.ingest(userId, krispNote({ id: kid, content: 'Note body one.' }));
    assert.equal(dupe.outcome, 'noop', JSON.stringify(dupe));
    assert.equal(dupe.meeting_id, first.meeting_id);

    // A different event (transcript) for the same no-start meeting → appended to
    // the same row via the stored-id fallback.
    const transcript = await svc.ingest(userId, krispNote({ id: kid, event: 'transcript_generated', content: 'Full transcript text.' }));
    assert.equal(transcript.outcome, 'updated', JSON.stringify(transcript));
    assert.equal(transcript.meeting_id, first.meeting_id);

    const after = await meetingsService.getById(userId, first.meeting_id);
    assert.match(after.body, /Note body one\./);
    assert.match(after.body, /Full transcript text\./);
    assert.match(after.body, /<!-- krisp:transcript -->/);
  });

  it('appends to an existing meeting whose start time is within the window, and links it', async () => {
    // A meeting that already exists in the CRM (stand-in for a calendar import),
    // far in the future so no seeded meeting is nearby. Internal so we need no account.
    const base = await meetingsService.create(userId, null, {
      date: '2030-03-01',
      starts_at: '2030-03-01T15:00:00.000Z',
      ends_at: '2030-03-01T16:00:00.000Z',
      title: 'ZZZ Existing Meeting',
      filename: `zzz-existing-${Date.now()}`,
      body: 'Pre-existing meeting notes.',
      internal: true,
    });
    createdMeetingIds.add(base.id);
    assert.equal(base.needs_review, false);

    // Krisp meeting started 3 min later and ran short — START is within ±10 min,
    // so it matches even though the END differs.
    const kid = `zzz_krisp_match_${Date.now()}`;
    const res = await svc.ingest(userId, krispNote({
      id: kid,
      start: '2030-03-01T15:03:00.000Z',
      end: '2030-03-01T15:38:00.000Z',
      content: 'Krisp notes for the existing meeting.',
    }));
    assert.equal(res.outcome, 'matched', JSON.stringify(res));
    assert.equal(res.meeting_id, base.id, 'appended to the existing meeting, no new row');

    const after = await meetingsService.getById(userId, base.id);
    assert.match(after.body, /Pre-existing meeting notes\./);
    assert.match(after.body, /Krisp notes for the existing meeting\./);
    assert.equal(after.krisp_meeting_id, kid, 'krisp id linked onto the matched meeting');
    assert.equal(after.needs_review, true, 'flagged for the user to verify the match');

    // A follow-up event for that Krisp id still resolves by time first; the stored
    // id is fallback only.
    const followup = await svc.ingest(userId, krispNote({ id: kid, event: 'outline_generated', content: 'Outline bullets.' }));
    assert.equal(followup.meeting_id, base.id, JSON.stringify(followup));
    const after2 = await meetingsService.getById(userId, base.id);
    assert.match(after2.body, /Outline bullets\./);
  });
});
