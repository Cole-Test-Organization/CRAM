// Notes-import re-import idempotency across an account-assignment change.
//
// The meeting filename is path-derived (stable across runs), but the two unique
// indexes that back it are PARTITIONED on (account_id IS NULL):
//   meetings_account_filename_uniq  (account_id, filename) WHERE account_id IS NOT NULL
//   meetings_internal_filename_uniq (user_id,   filename) WHERE account_id IS NULL
// So a note that PARKS on run #1 (account_id NULL) but resolves to a confident
// account on run #2 (the local LLM is nondeterministic; or the user created the
// account in between) lands in the OTHER partition and would NOT trip a 23505 —
// silently producing two meetings for one source file. _writeOne now looks up an
// existing meeting by filename REGARDLESS of account_id before inserting and
// reports a repeat as "skipped".
//
// This drives the real services against the test DB (like mcp.test.js), injecting
// a stub `extractor` — the constructor hook documented for exactly this — so we
// flip the account resolution between runs with no LLM and no network.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AccountsService } from '../src/services/accounts/accounts.js';
import { ContactsService } from '../src/services/contacts/contacts.js';
import { MeetingsService } from '../src/services/meetings/meetings.js';
import { NotesImportService } from '../src/services/notes/notes-import.js';
import { getDefaultUserId } from '../src/auth.js';
import { closeDb } from '../src/db/connection.js';
import { del } from './helpers.js';

let userId;
let meetingsService;
let svc;
const createdMeetingIds = new Set();

// Run a one-file import to completion and return the single result row.
async function importOne(file) {
  const jobId = svc.enqueue(userId, { files: [file] });
  // Worker runs in-process and serially; poll the in-memory job until done.
  for (let i = 0; i < 200; i++) {
    const job = svc.getJob(jobId);
    if (job.status === 'completed' || job.status === 'failed') {
      assert.equal(job.status, 'completed', `import job failed: ${job.error}`);
      assert.equal(job.results.length, 1);
      return job.results[0];
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('import job did not finish in time');
}

describe('Notes-import — re-import is idempotent across an account-assignment change', () => {
  before(async () => {
    userId = await getDefaultUserId();
    const accountsService = new AccountsService();
    const contactsService = new ContactsService();
    meetingsService = new MeetingsService({ contactsService, accountsService });
    // extractor is swapped per-run inside the test (start parked: internal → no hint).
    svc = new NotesImportService({
      meetingsService,
      accountsService,
      extractor: () => ({ is_internal: true }),
    });
  });

  after(async () => {
    // The suite shares one seeded DB with no per-test reset, so remove any
    // meeting we created to keep seed-invariants.test.js exact.
    for (const id of createdMeetingIds) {
      try { await del(`/meetings/${id}`); } catch { /* best effort */ }
    }
    await closeDb(); // release this process's PG pool so node --test can exit
  });

  it('a parked note that resolves to an account on re-import stays one meeting (skipped)', async () => {
    const file = { path: `zzz-test/${Date.now()}-reimport-dup.md`, content: '# zzz reimport note\nbody text' };

    // Run #1: extractor says internal → no account hint → PARKED (account_id NULL).
    svc.extractor = () => ({ is_internal: true });
    const first = await importOne(file);
    assert.equal(first.outcome, 'parked', JSON.stringify(first));
    assert.equal(first.account_id, null);
    assert.ok(first.meeting_id);
    createdMeetingIds.add(first.meeting_id);

    // Run #2: same path (same derived filename), but now the extractor confidently
    // names a real seeded account → would LINK (account_id set) → the OTHER unique
    // partition. Pre-fix this inserted a second meeting (no cross-partition
    // collision); post-fix the filename lookup catches it first.
    svc.extractor = () => ({ account_name: 'Acme Manufacturing', is_internal: false });
    const second = await importOne(file);
    assert.equal(second.outcome, 'skipped', JSON.stringify(second));
    assert.equal(second.reason, 'duplicate');
    assert.equal(second.meeting_id, first.meeting_id, 'skip must point at the existing meeting');

    // The parked meeting is left exactly as-is — not relinked to the account.
    const m = await meetingsService.getById(userId, first.meeting_id);
    assert.ok(m, 'the original meeting still exists');
    assert.equal(m.account_id, null, 'the parked note keeps its (NULL) account — triage preserved');
  });

  it('findByFilename matches an account-LINKED meeting (covers the reverse partition)', async () => {
    // The reverse direction (linked on run #1 → parked on run #2) would also have
    // duplicated, so the lookup must match a row sitting in the (account_id NOT
    // NULL) partition too. Mint a linked meeting via the import path, then look it
    // up by its stored filename.
    const file = { path: `zzz-test/${Date.now()}-linked-lookup.md`, content: '# zzz linked\nbody' };
    svc.extractor = () => ({ account_name: 'Acme Manufacturing', is_internal: false });
    const res = await importOne(file);
    assert.equal(res.outcome, 'linked', JSON.stringify(res));
    createdMeetingIds.add(res.meeting_id);

    const m = await meetingsService.getById(userId, res.meeting_id);
    const hit = await meetingsService.findByFilename(userId, m.filename);
    assert.ok(hit, 'findByFilename should match an account-linked meeting');
    assert.equal(hit.id, res.meeting_id);
    assert.ok(hit.account_id, 'the matched row carries its account_id');
  });
});
