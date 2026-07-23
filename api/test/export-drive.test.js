import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import Fastify from 'fastify';
import mammoth from 'mammoth';
import { buildDriveArchive } from '../src/services/export/drive-archive.js';
import exportRoutes from '../src/routes/export/export.js';

const sampleFiles = [
  {
    path: 'acme-manufacturing/_account.md',
    content: '# Acme Manufacturing\n\n**Status:** account\n\n## Relationship Summary\n\nStrategic customer.',
  },
  {
    path: 'acme-manufacturing/contacts.md',
    content: '# Acme Manufacturing — Contacts\n\n## Ada Lovelace\n\n- **Title:** CTO',
  },
  {
    path: 'acme-manufacturing/meetings/2026-07-20-quarterly-review.md',
    content: '# 2026-07-20 - quarterly review\n\n**Attendees:** Ada Lovelace\n\n## Notes\n\n- Reviewed **renewal timing**\n- [x] Send architecture diagram',
  },
];

const secondAccountFiles = [
  {
    path: 'riverstone-health/_account.md',
    content: '# Riverstone Health System\n\n**Status:** account',
  },
  {
    path: 'riverstone-health/meetings/2026-07-18-security-review.md',
    content: '# 2026-07-18 - security review\n\n## Notes\n\nReviewed the rollout.',
  },
];

describe('Google Drive account export', () => {
  it('builds an account folder with overview, contacts, and one readable DOCX per meeting', async () => {
    const archive = await buildDriveArchive(sampleFiles);

    const zip = new AdmZip(archive);
    const names = zip.getEntries().filter((entry) => !entry.isDirectory).map((entry) => entry.entryName).sort();

    assert.deepEqual(names, [
      'acme-manufacturing/Account Overview.docx',
      'acme-manufacturing/Contacts.docx',
      'acme-manufacturing/Meetings/2026-07-20-quarterly-review.docx',
      'acme-manufacturing/README.txt',
    ]);

    const meeting = zip.getEntry('acme-manufacturing/Meetings/2026-07-20-quarterly-review.docx');
    assert.ok(meeting, 'meeting document is present');
    const extracted = await mammoth.extractRawText({ buffer: meeting.getData() });
    assert.match(extracted.value, /2026-07-20 - quarterly review/);
    assert.match(extracted.value, /Ada Lovelace/);
    assert.match(extracted.value, /Reviewed renewal timing/);
    assert.match(extracted.value, /☒ Send architecture diagram/);

    const readme = zip.getEntry('acme-manufacturing/README.txt');
    assert.match(readme.getData().toString('utf8'), /New > Folder upload/);
  });

  it('serves the archive with download headers and a useful 404', async (t) => {
    const app = Fastify();
    t.after(() => app.close());
    await app.register(exportRoutes, {
      exportService: {
        exportAccount: async (_userId, slug) => slug === 'acme-manufacturing' ? sampleFiles : null,
        exportAccounts: async (_userId, slugs) => {
          const missing = slugs.find((slug) => !['acme-manufacturing', 'riverstone-health'].includes(slug));
          if (missing) throw Object.assign(new Error(`Account not found: ${missing}`), { statusCode: 404 });
          return slugs.flatMap((slug) => slug === 'acme-manufacturing' ? sampleFiles : secondAccountFiles);
        },
        exportAll: async () => sampleFiles,
      },
    });

    const response = await app.inject({ method: 'GET', url: '/export/accounts/acme-manufacturing' });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'], /^application\/zip/);
    assert.match(response.headers['content-disposition'], /acme-manufacturing-google-drive\.zip/);
    assert.ok(new AdmZip(response.rawPayload).getEntry('acme-manufacturing/Account Overview.docx'));

    const missing = await app.inject({ method: 'GET', url: '/export/accounts/not-found' });
    assert.equal(missing.statusCode, 404);
    assert.deepEqual(missing.json(), { error: 'Account not found' });
  });

  it('serves a selected multi-account bundle as one archive and rejects an incomplete selection', async (t) => {
    const app = Fastify();
    t.after(() => app.close());
    await app.register(exportRoutes, {
      exportService: {
        exportAccount: async () => null,
        exportAccounts: async (_userId, slugs) => {
          const missing = slugs.find((slug) => !['acme-manufacturing', 'riverstone-health'].includes(slug));
          if (missing) throw Object.assign(new Error(`Account not found: ${missing}`), { statusCode: 404 });
          return slugs.flatMap((slug) => slug === 'acme-manufacturing' ? sampleFiles : secondAccountFiles);
        },
        exportAll: async () => [],
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/export/accounts',
      payload: { slugs: ['acme-manufacturing', 'riverstone-health'] },
    });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'], /^application\/zip/);
    assert.match(response.headers['content-disposition'], /accounts-google-drive-\d{4}-\d{2}-\d{2}\.zip/);

    const zip = new AdmZip(response.rawPayload);
    assert.ok(zip.getEntry('acme-manufacturing/Account Overview.docx'));
    assert.ok(zip.getEntry('riverstone-health/Account Overview.docx'));
    assert.ok(zip.getEntry('riverstone-health/Meetings/2026-07-18-security-review.docx'));
    assert.ok(zip.getEntry('README.txt'));

    const missing = await app.inject({
      method: 'POST',
      url: '/export/accounts',
      payload: { slugs: ['acme-manufacturing', 'missing-account'] },
    });
    assert.equal(missing.statusCode, 404);
    assert.deepEqual(missing.json(), { error: 'Account not found: missing-account' });

    const empty = await app.inject({ method: 'POST', url: '/export/accounts', payload: { slugs: [] } });
    assert.equal(empty.statusCode, 400);
  });
});
