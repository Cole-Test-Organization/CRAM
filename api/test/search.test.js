import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { get } from './helpers.js';

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
});
