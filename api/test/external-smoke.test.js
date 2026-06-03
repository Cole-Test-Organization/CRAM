import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { get, post, put, patch } from './helpers.js';

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

describe('Export — read-only markdown bundles', () => {
  it('GET a seeded account export (200); unknown slug 404', async () => {
    assert.equal((await get('/export/accounts/acme-manufacturing')).status, 200);
    assert.equal((await get('/export/accounts/zzz-nope-99999')).status, 404);
  });
});
