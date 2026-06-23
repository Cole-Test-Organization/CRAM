import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { noteFilesFromZip } from '../src/services/_shared/_note-file-conversion.js';
import { makeDocx, makeGoogleDriveNotesZip, makePdf } from './fixtures/google-drive-zip.js';

describe('Note file conversion', () => {
  it('extracts text files and converts DOCX/PDF entries from a zip', async () => {
    const zip = new AdmZip();
    zip.addFile('notes/acme.md', Buffer.from('# Acme note\nPlain text body', 'utf8'));
    zip.addFile('drive/google-doc.docx', makeDocx('Google Drive doc body'));
    zip.addFile('drive/text-pdf.pdf', makePdf('Google Drive PDF body'));
    zip.addFile('drive/image.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    zip.addFile('__MACOSX/._junk', Buffer.from('junk', 'utf8'));

    const result = await noteFilesFromZip(zip.toBuffer());

    assert.equal(result.files.length, 3);
    assert.equal(result.summary.files, 3);
    assert.equal(result.summary.text_files, 1);
    assert.equal(result.summary.converted_files, 2);
    assert.equal(result.summary.docx_files, 1);
    assert.equal(result.summary.pdf_files, 1);
    assert.equal(result.summary.skipped_by_reason.unsupported, 1);
    assert.equal(result.summary.skipped_by_reason.junk, 1);

    const byPath = new Map(result.files.map((file) => [file.path, file.content]));
    assert.match(byPath.get('notes/acme.md'), /Plain text body/);
    assert.match(byPath.get('drive/google-doc.docx'), /Google Drive doc body/);
    assert.match(byPath.get('drive/text-pdf.pdf'), /Google Drive PDF body/);
  });

  it('recognizes a Google Drive-style zip as convertible notes plus skipped junk', async () => {
    const result = await noteFilesFromZip(makeGoogleDriveNotesZip({ prefix: `gdrive-${Date.now()}` }));

    assert.equal(result.files.length, 2);
    assert.equal(result.summary.converted_files, 2);
    assert.equal(result.summary.docx_files, 1);
    assert.equal(result.summary.pdf_files, 1);
    assert.equal(result.summary.skipped_by_reason.unsupported, 1);
    assert.equal(result.summary.skipped_by_reason.junk, 1);

    const content = result.files.map((file) => file.content).join('\n');
    assert.match(content, /Google Drive doc body for Acme Manufacturing/);
    assert.match(content, /Google Drive PDF body for Acme Manufacturing/);
  });
});
