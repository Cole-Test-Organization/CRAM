import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { get, makeAccount } from './helpers.js';

describe('Search', () => {
  it('requires q (400 without it)', async () => {
    assert.equal((await get('/search')).status, 400);
  });

  it('finds a seeded account by name', async () => {
    const res = await get('/search?q=Acme&type=accounts&limit=5');
    assert.equal(res.status, 200);
    assert.ok(JSON.stringify(res.body).toLowerCase().includes('acme'), 'Acme should surface in results');
  });

  it('type=all returns a results structure', async () => {
    const res = await get('/search?q=security&type=all&limit=5');
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.total, 'number');
    assert.ok(res.body.results);
  });

  it('escapes stored HTML in snippets while preserving search highlights', async (t) => {
    const marker = `zzzxss${Date.now()}`;
    const created = await makeAccount(t, {
      relationship_summary: `literal < ampersand & quote " ${marker} security`,
    });
    assert.equal(created.status, 201);

    const res = await get(`/search?q=${marker}&type=accounts&limit=5`);
    assert.equal(res.status, 200);
    const account = res.body.results.accounts.find((row) => row.id === created.body.id);
    assert.ok(account, 'created account should be in search results');
    assert.match(account.snippet, /<mark>[^<]*zzzxss/i);
    assert.ok(!account.snippet.includes('literal <'), 'raw less-than characters must not survive');
    assert.ok(account.snippet.includes('literal &lt;'), 'stored less-than characters should be escaped');
    assert.ok(account.snippet.includes('&amp;'), 'stored ampersands should be escaped');
    assert.ok(account.snippet.includes('&quot;'), 'stored quotes should be escaped');
  });
});
