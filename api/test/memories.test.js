import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { get, post, patch, del, listFrom, deleteAfter } from './helpers.js';

describe('Memories — CRUD', () => {
  it('POST requires content; create / get / list / patch / delete', async (t) => {
    assert.equal((await post('/memories', { title: 'x' })).status, 400);
    const created = await post('/memories', { content: 'zzz remember this', title: 'ZZZ Memo' });
    assert.equal(created.status, 201);
    const id = created.body.id;
    deleteAfter(t, `/memories/${id}`);
    assert.equal((await get(`/memories/${id}`)).status, 200);
    assert.ok(listFrom((await get('/memories')).body).some((m) => m.id === id));
    const upd = await patch(`/memories/${id}`, { enabled: false });
    assert.equal(upd.status, 200);
    assert.equal(upd.body.enabled, false);
    assert.equal((await del(`/memories/${id}`)).status, 200);
    assert.equal((await get(`/memories/${id}`)).status, 404);
  });

  it('enabled filter is exact', async (t) => {
    const created = await post('/memories', { content: 'zzz disabled memo', enabled: false });
    deleteAfter(t, `/memories/${created.body.id}`);
    assert.ok(!listFrom((await get('/memories?enabled=true')).body).some((m) => m.id === created.body.id));
    assert.ok(listFrom((await get('/memories?enabled=false')).body).some((m) => m.id === created.body.id));
  });
});
