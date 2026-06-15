import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AccountsService } from '../src/services/accounts/accounts.js';
import { ContactsService } from '../src/services/contacts/contacts.js';
import { MeetingsService } from '../src/services/meetings/meetings.js';
import { NotesImportService } from '../src/services/notes/notes-import.js';
import { noteFilesFromZip } from '../src/services/_shared/_note-file-conversion.js';
import { getDefaultUserId } from '../src/auth.js';
import { closeDb } from '../src/db/connection.js';
import { makeGoogleDriveNotesZip } from './fixtures/google-drive-zip.js';

let userId;
let meetingsService;
let svc;
const createdMeetingIds = new Set();

async function importFiles(files) {
  const jobId = svc.enqueue(userId, { files });
  for (let i = 0; i < 200; i++) {
    const job = svc.getJob(jobId);
    if (job.status === 'completed' || job.status === 'failed') {
      assert.equal(job.status, 'completed', `import job failed: ${job.error}`);
      assert.equal(job.results.length, files.length);
      return job.results;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('import job did not finish in time');
}

describe('Notes-import — Google Drive zip conversion uses the normal import pipeline', () => {
  before(async () => {
    userId = await getDefaultUserId();
    const accountsService = new AccountsService();
    const contactsService = new ContactsService();
    meetingsService = new MeetingsService({ contactsService, accountsService });
    svc = new NotesImportService({
      meetingsService,
      accountsService,
      extractor: (file) => ({
        date: '2026-05-22',
        title: file.path.endsWith('.docx') ? 'GDrive DOCX import' : 'GDrive PDF import',
        account_name: 'Acme Manufacturing',
        is_internal: false,
      }),
    });
  });

  after(async () => {
    for (const id of createdMeetingIds) {
      try { await meetingsService.delete(userId, id); } catch { /* best effort */ }
    }
    await closeDb();
  });

  it('converts DOCX/PDF entries from a Drive-style zip and creates meetings', async () => {
    const prefix = `gdrive-${Date.now()}`;
    const { files, summary } = await noteFilesFromZip(makeGoogleDriveNotesZip({ prefix }));

    assert.equal(files.length, 2);
    assert.equal(summary.converted_files, 2);
    assert.equal(summary.docx_files, 1);
    assert.equal(summary.pdf_files, 1);

    const results = await importFiles(files);
    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r.outcome === 'linked'), JSON.stringify(results));

    const byPath = new Map(results.map((result) => [result.path, result]));
    for (const file of files) {
      const result = byPath.get(file.path);
      assert.ok(result?.meeting_id, `missing meeting for ${file.path}`);
      createdMeetingIds.add(result.meeting_id);

      const meeting = await meetingsService.getById(userId, result.meeting_id);
      assert.ok(meeting, `meeting not found for ${file.path}`);
      assert.equal(meeting.account_slug, 'acme-manufacturing');
      assert.equal(meeting.internal, false);
      assert.equal(meeting.needs_review, false);
      assert.equal(meeting.body, file.content);
      assert.match(meeting.body, /Google Drive (doc|PDF) body for Acme Manufacturing/);
    }
  });
});
