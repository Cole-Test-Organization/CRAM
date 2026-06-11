// Calendar re-import backfill must target the actually-STORED meeting row.
//
// The documented idempotent-re-import behavior: the first import of an event
// that predates time-of-day capture stores a meeting with NULL starts_at/
// ends_at/location; a later re-import of the same event (now carrying times)
// trips the filename unique index (23505), is reported "skipped", and
// backfills the missing times onto that existing row so the Today timeline
// lights up.
//
// The bug this guards against: calendar-import derived the filename as the raw
// "cal-<eventId>" but meetingsService.create STORES deriveFilename()'s
// slugified, ".md"-suffixed form ("cal-<eventId>.md"); the backfill matched the
// raw value and so updated zero rows — backfilled was always false and times
// never persisted. The backfill now targets the stored filename, scoped to the
// same account partition the insert collided with.
//
// Drives the real CalendarImportService against the seeded test DB (the pattern
// notes-import-idempotency.test.js uses) — no LLM, no network. Uses an existing
// seeded customer domain (acmemfg.com → Acme Manufacturing) so no account is
// minted; the one created contact + meeting are cleaned up after.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AccountsService } from '../src/services/accounts/accounts.js';
import { ContactsService } from '../src/services/contacts/contacts.js';
import { MeetingsService } from '../src/services/meetings/meetings.js';
import { InternalDomainsService } from '../src/services/internal-domains/internal-domains.js';
import { CalendarImportService } from '../src/services/calendar-import/calendar-import.js';
import { deriveFilename } from '../src/services/_shared/_slug.js';
import { getDefaultUserId } from '../src/auth.js';
import { closeDb } from '../src/db/connection.js';
import { del } from './helpers.js';

let userId;
let meetingsService;
let contactsService;
let svc;
const createdMeetingIds = new Set();
const createdContactEmails = new Set();

describe('Calendar re-import — backfill targets the stored filename / account row', () => {
  before(async () => {
    userId = await getDefaultUserId();
    const accountsService = new AccountsService();
    const internalDomainsService = new InternalDomainsService();
    contactsService = new ContactsService({ accountsService, internalDomainsService });
    meetingsService = new MeetingsService({ contactsService, accountsService, internalDomainsService });
    svc = new CalendarImportService({
      meetingsService,
      accountsService,
      contactsService,
      internalDomainsService,
    });
  });

  after(async () => {
    // Shared, un-reset seeded DB — remove what we created so seed-invariants
    // stays exact (deleting the meeting cascades its attendee links).
    for (const id of createdMeetingIds) {
      try { await del(`/meetings/${id}`); } catch { /* best effort */ }
    }
    for (const email of createdContactEmails) {
      try {
        const c = await contactsService.getByEmail(userId, email);
        if (c?.id) await del(`/contacts/${c.id}`);
      } catch { /* best effort */ }
    }
    await closeDb();
  });

  it('a re-import that now carries times backfills them onto the existing row', async () => {
    // A guest on an existing seeded customer domain → the meeting links to Acme
    // Manufacturing (no account minted), and one contact is created. The event
    // id mimics a real Google id (has an "@…" suffix) so the raw-vs-stored
    // filename mismatch the fix addresses is actually exercised.
    const attendeeEmail = `zzztest.cal-${Date.now()}@acmemfg.com`;
    createdContactEmails.add(attendeeEmail);
    const eventId = `zzz_cal_${Date.now()}@google.com`;
    const date = '2026-06-11';
    const title = 'ZZZ Calendar Backfill Test';
    const event = {
      id: eventId,
      title,
      date, // no `start`/`end` → first import stores NULL starts_at/ends_at
      guests: [{ email: attendeeEmail, name: 'ZZZ Cal Tester', status: 'Going' }],
      myStatus: 'Going',
    };

    // The filename meetingsService.create will actually STORE for this event
    // (raw "cal-<eventId>" run through deriveFilename — slugified + ".md").
    const storedFilename = deriveFilename(date, title, `cal-${eventId}`);
    assert.notEqual(storedFilename, `cal-${eventId}`, 'sanity: stored form differs from raw');

    // Run #1: no times → meeting created with NULL starts_at/ends_at/location.
    const first = await svc.importDay(userId, { date, timezone: 'UTC', meetings: [event] });
    const r1 = first.results[0];
    assert.equal(r1.outcome, 'account', JSON.stringify(r1));
    assert.equal(r1.account_slug, 'acme-manufacturing', JSON.stringify(r1));
    assert.ok(r1.meeting_id, 'first import creates the meeting');
    createdMeetingIds.add(r1.meeting_id);

    const before = await meetingsService.getById(userId, r1.meeting_id);
    assert.equal(before.starts_at, null, 'first import leaves starts_at NULL');
    assert.equal(before.ends_at, null, 'first import leaves ends_at NULL');
    assert.equal(before.location, null, 'first import leaves location NULL');
    assert.equal(before.filename, storedFilename, 'row stored under the derived filename');

    // Run #2: SAME event id, now carrying start/end/location → 23505 on the
    // filename unique index → reported "skipped" → backfill fills the NULLs.
    // Pre-fix, the backfill matched the raw "cal-<eventId>" and updated nothing.
    const startsAt = '2026-06-11T15:00:00.000Z';
    const endsAt = '2026-06-11T15:30:00.000Z';
    const location = 'https://meet.google.com/zzz-test';
    const event2 = { ...event, start: startsAt, end: endsAt, location };
    const second = await svc.importDay(userId, { date, timezone: 'UTC', meetings: [event2] });
    const r2 = second.results[0];
    assert.equal(r2.outcome, 'skipped', JSON.stringify(r2));
    assert.equal(r2.reason, 'duplicate', JSON.stringify(r2));
    assert.equal(r2.backfilled, true, 'the backfill must hit the stored row (this was the bug)');

    // The existing meeting now carries the times + join link.
    const after = await meetingsService.getById(userId, r1.meeting_id);
    assert.ok(after.starts_at, 'starts_at backfilled');
    assert.equal(new Date(after.starts_at).toISOString(), startsAt, 'starts_at value persisted');
    assert.equal(new Date(after.ends_at).toISOString(), endsAt, 'ends_at value persisted');
    assert.equal(after.location, location, 'location backfilled');
    assert.equal(after.id, before.id, 're-import did not create a second meeting');

    // Run #3: same event yet again — every column is now populated, so the
    // COALESCE/WHERE guard finds nothing to fill and reports backfilled:false.
    // Proves the backfill never re-touches an already-populated row.
    const third = await svc.importDay(userId, { date, timezone: 'UTC', meetings: [event2] });
    const r3 = third.results[0];
    assert.equal(r3.outcome, 'skipped', JSON.stringify(r3));
    assert.equal(r3.backfilled, false, 'an already-filled row reports nothing backfilled');
  });
});
