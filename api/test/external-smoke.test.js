import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { BASE, get, post, put, patch } from './helpers.js';
import { getDefaultUserId } from '../src/auth.js';
import { closeDb, withUser } from '../src/db/connection.js';
import { AgentSettingsService } from '../src/services/agent/agent-settings.js';

after(() => closeDb());

// The "outside-dependency" resources. We exercise ONLY the safe, deterministic
// parts — input validation, enqueue/response shape, read-only endpoints — and
// never trigger the real dependency (no LLM, no LinkedIn login, no pg_dump, no
// file writes). The harness runs without Ollama, so anything that would call the
// model is asserted at the validation boundary instead.

describe('Agent — validation + read-only (no LLM)', () => {
  it('GET /agent returns the markdown instructions doc', async () => {
    assert.equal((await get('/agent')).status, 200);
  });

  it('POST /agent/query requires a prompt (400) — never reaches the model', async () => {
    assert.equal((await post('/agent/query', {})).status, 400);
    assert.equal((await post('/agent/query', { prompt: '' })).status, 400);
  });

  it('GET /agent/settings returns the config shape', async () => {
    const res = await get('/agent/settings');
    assert.equal(res.status, 200);
    assert.ok('default_system_prompt' in res.body);
  });

  it('PATCH /agent/settings rejects an invalid provider (400)', async () => {
    assert.equal((await patch('/agent/settings', { provider: 'openai' })).status, 400);
  });

  it('stores the local LLM bearer token encrypted and exposes only its presence', async (t) => {
    const secret = 'zzz-test-llm-bearer-token-plaintext';
    const original = (await get('/agent/settings')).body;
    t.after(() => patch('/agent/settings', {
      model: original.model,
      local_api_key: null,
    }));

    const saved = await patch('/agent/settings', {
      model: 'zzz-test-secure-model',
      local_api_key: `Bearer ${secret}`,
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.has_local_api_key, true);
    assert.ok(!('local_api_key' in saved.body));

    const read = await get('/agent/settings');
    assert.equal(read.status, 200);
    assert.equal(read.body.has_local_api_key, true);
    assert.ok(!('local_api_key' in read.body));

    const userId = await getDefaultUserId();
    const encrypted = await withUser(userId, async (client) => (
      await client.query(
        `SELECT local_api_key_ciphertext, local_api_key_iv,
                local_api_key_auth_tag, local_api_key_algo,
                local_api_key_key_version
         FROM user_agent_settings`,
      )
    ).rows[0]);
    assert.ok(Buffer.isBuffer(encrypted.local_api_key_ciphertext));
    assert.ok(Buffer.isBuffer(encrypted.local_api_key_iv));
    assert.ok(Buffer.isBuffer(encrypted.local_api_key_auth_tag));
    assert.equal(encrypted.local_api_key_algo, 'aes-256-gcm');
    assert.equal(encrypted.local_api_key_key_version, 1);
    assert.equal(encrypted.local_api_key_ciphertext.includes(Buffer.from(secret)), false);

    const effective = await new AgentSettingsService().getEffective(userId);
    assert.equal(effective.local_api_key, secret);

    const cleared = await patch('/agent/settings', {
      model: original.model,
      local_api_key: null,
    });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.has_local_api_key, false);
  });
});

describe('Outreach — enqueue + poll shape (no LinkedIn)', () => {
  it('enqueue returns a job; poll by id; stats; 404 unknown job', async () => {
    const enq = await post('/outreach/enrich', { type: 'company', name: 'ZZZ Outreach Co', linkedin: false });
    assert.equal(enq.status, 202);
    assert.ok(enq.body.jobId);
    assert.ok(['queued', 'running', 'completed', 'failed'].includes(enq.body.status));
    const poll = await get(`/outreach/enrich/${enq.body.jobId}`);
    assert.equal(poll.status, 200);
    assert.equal(poll.body.jobId, enq.body.jobId);
    assert.equal((await get('/outreach/enrich/zzz-nope-99999')).status, 404);
    assert.equal((await get('/outreach/stats')).status, 200);
  });

  it('enqueue requires type and name (400)', async () => {
    assert.equal((await post('/outreach/enrich', { name: 'no type' })).status, 400);
    assert.equal((await post('/outreach/enrich', { type: 'company' })).status, 400);
  });
});

describe('Notes-import — validation + job shape (no LLM, no real enqueue)', () => {
  // Deliberately NOT enqueuing a real job: its async worker calls the local model
  // and (on a confident parse) can auto-create accounts/meetings, which would race
  // the seed-count invariants. Validation + listing covers the contract safely.
  it('rejects missing / empty files (400)', async () => {
    assert.equal((await post('/notes-import', {})).status, 400);
    assert.equal((await post('/notes-import', { files: [] })).status, 400);
  });

  it('lists jobs; 404 for an unknown job id', async () => {
    const list = await get('/notes-import/jobs');
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.body.jobs));
    assert.equal((await get('/notes-import/jobs/zzz-nope-99999')).status, 404);
  });
});

describe('Backup — settings + validation (no pg_dump)', () => {
  it('GET settings returns config; invalid retention rejected (400)', async () => {
    const res = await get('/backup/settings');
    assert.equal(res.status, 200);
    assert.equal(typeof res.body, 'object');
    assert.equal((await put('/backup/settings', { retention_count: -1 })).status, 400);
  });
});

describe('Export — Google Drive document folders', () => {
  it('GET a seeded account export returns a Drive-ready zip; unknown slug 404', async () => {
    const response = await fetch(`${BASE}/export/accounts/acme-manufacturing`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /^application\/zip/);
    assert.match(response.headers.get('content-disposition') || '', /acme-manufacturing-google-drive\.zip/);

    const zip = new AdmZip(Buffer.from(await response.arrayBuffer()));
    const names = zip.getEntries().filter((entry) => !entry.isDirectory).map((entry) => entry.entryName);
    assert.ok(names.includes('acme-manufacturing/Account Overview.docx'));
    assert.ok(names.includes('acme-manufacturing/Contacts.docx'));
    assert.ok(names.includes('acme-manufacturing/README.txt'));
    assert.ok(names.some((name) => /^acme-manufacturing\/Meetings\/.+\.docx$/.test(name)));

    assert.equal((await get('/export/accounts/zzz-nope-99999')).status, 404);
  });

  it('POST selected account slugs returns one zip with one folder per account', async () => {
    const response = await fetch(`${BASE}/export/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slugs: ['acme-manufacturing', 'riverstone-health'] }),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-disposition') || '', /accounts-google-drive-\d{4}-\d{2}-\d{2}\.zip/);

    const zip = new AdmZip(Buffer.from(await response.arrayBuffer()));
    assert.ok(zip.getEntry('acme-manufacturing/Account Overview.docx'));
    assert.ok(zip.getEntry('riverstone-health/Account Overview.docx'));
    assert.ok(zip.getEntry('README.txt'));

    const incomplete = await fetch(`${BASE}/export/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slugs: ['acme-manufacturing', 'zzz-nope-99999'] }),
    });
    assert.equal(incomplete.status, 404);
    assert.deepEqual(await incomplete.json(), { error: 'Account not found: zzz-nope-99999' });
  });
});
