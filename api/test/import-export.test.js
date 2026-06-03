import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { get, post, uniqueSlug, deleteAfter } from './helpers.js';

describe('Import/export — portable JSON bundle', () => {
  it('export a seeded account → bundle with one account', async () => {
    const exp = await post('/import-export/export', { slugs: ['acme-manufacturing'] });
    assert.equal(exp.status, 200);
    assert.ok(Array.isArray(exp.body.accounts));
    assert.equal(exp.body.accounts.length, 1);
  });

  it('GET single-account export; 404 for an unknown slug', async () => {
    assert.equal((await get('/import-export/accounts/acme-manufacturing')).status, 200);
    assert.equal((await get('/import-export/accounts/zzz-nope-99999')).status, 404);
  });

  it('export requires slugs (400)', async () => {
    assert.equal((await post('/import-export/export', {})).status, 400);
  });

  it('re-importing a bundle is idempotent — no duplicate accounts', async (t) => {
    // throwaway account so the seeded counts are never at risk
    const slug = uniqueSlug();
    const acc = await post('/accounts', { slug, name: 'ZZZ Export Co', domains: [`${slug}.example`] });
    deleteAfter(t, `/accounts/${acc.body.id}`);
    const before = (await get('/accounts')).body.total;
    const bundle = (await post('/import-export/export', { slugs: [slug] })).body;
    const imp = await post('/import-export/import', bundle);
    assert.equal(imp.status, 200);
    const after = (await get('/accounts')).body.total;
    assert.equal(after, before, 'idempotent re-import must not create duplicate accounts');
  });
});
