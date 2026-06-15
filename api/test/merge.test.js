// Generic merge — meetings handler. Folds a SOURCE meeting into a BASE: keep/take
// scalars per choice, append notes, bring chosen attendees over, tombstone the
// source. Drives the real MergeService against the seeded test DB. Created rows
// (incl. the tombstoned source) are hard-deleted after.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AccountsService } from '../src/services/accounts/accounts.js';
import { ContactsService } from '../src/services/contacts/contacts.js';
import { MeetingsService } from '../src/services/meetings/meetings.js';
import { InternalDomainsService } from '../src/services/internal-domains/internal-domains.js';
import { MergeService } from '../src/services/merge/merge.js';
import { MeetingMergeHandler } from '../src/services/merge/handlers/meetings.js';
import { getDefaultUserId } from '../src/auth.js';
import { withUser, closeDb } from '../src/db/connection.js';

let userId;
let meetingsService;
let merge;
const createdMeetingIds = new Set();

describe('Merge — meetings', () => {
  before(async () => {
    userId = await getDefaultUserId();
    const accountsService = new AccountsService();
    const internalDomainsService = new InternalDomainsService();
    const contactsService = new ContactsService({ accountsService, internalDomainsService });
    meetingsService = new MeetingsService({ contactsService, accountsService, internalDomainsService });
    merge = new MergeService({ meetings: new MeetingMergeHandler({ meetingsService }) });
  });

  after(async () => {
    const ids = [...createdMeetingIds];
    if (ids.length) {
      await withUser(userId, async (client) => {
        await client.query('DELETE FROM meeting_attendees WHERE meeting_id = ANY($1::bigint[])', [ids]);
        await client.query('DELETE FROM meetings WHERE id = ANY($1::bigint[])', [ids]);
      });
    }
    await closeDb();
  });

  it('previews a plan, then folds source→base non-destructively and tombstones the source', async () => {
    const stamp = Date.now();
    const base = await meetingsService.create(userId, null, {
      date: '2030-04-01', title: 'ZZZ Base Meeting', filename: `zzz-merge-base-${stamp}`,
      body: 'Base notes.', internal: true,
    });
    const source = await meetingsService.create(userId, null, {
      date: '2030-04-01', title: 'ZZZ Source Meeting', filename: `zzz-merge-source-${stamp}`,
      body: 'Source notes.', internal: true, attendees: 'ZZZ Source Attendee',
    });
    createdMeetingIds.add(base.id);
    createdMeetingIds.add(source.id);

    // Preview returns both records' fields + the attendee collection.
    const plan = await merge.preview(userId, 'meetings', base.id, source.id);
    assert.equal(plan.entity, 'meetings');
    const titleField = plan.fields.find((f) => f.key === 'title');
    assert.equal(titleField.base, 'ZZZ Base Meeting');
    assert.equal(titleField.source, 'ZZZ Source Meeting');
    const att = plan.collections.find((c) => c.key === 'attendees');
    assert.equal(att.source.length, 1, 'source attendee shows in the plan');
    const srcAttendeeId = att.source[0].id;

    // Apply: take the source title, append both bodies (default), bring the attendee.
    const res = await merge.apply(userId, 'meetings', base.id, source.id, {
      fields: { title: 'source' },
      append: { body: 'both' },
      collections: { attendees: [srcAttendeeId] },
    });
    assert.equal(res.soft_deleted, true);

    const merged = await meetingsService.getById(userId, base.id);
    assert.equal(merged.title, 'ZZZ Source Meeting', 'took the source title');
    assert.match(merged.body, /Base notes\./, 'base notes kept');
    assert.match(merged.body, /Source notes\./, 'source notes appended');
    assert.equal(merged.needs_review, false, 'merge settles needs_review');
    assert.ok(merged.attendees.includes('ZZZ Source Attendee'), 'attendee brought over');

    // The source is tombstoned: gone from every read path.
    assert.equal(await meetingsService.getById(userId, source.id), null, 'source not fetchable');
    const all = await meetingsService.getAll(userId, { limit: 100000 });
    assert.ok(!all.some((m) => m.id === source.id), 'source absent from list');
  });

  it('rejects self-merge and unknown entities', async () => {
    await assert.rejects(() => merge.apply(userId, 'meetings', 5, 5, {}), /must differ/);
    await assert.rejects(() => merge.preview(userId, 'contacts', 1, 2), /Unknown merge entity/);
  });
});
