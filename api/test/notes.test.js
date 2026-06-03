import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { get, post, patch, del, listFrom, deleteAfter, aCustomerAccount } from './helpers.js';

describe('Notes — CRUD + exactly-one-target rule', () => {
  it('POST creates a note on an account (201); GET / list / PATCH / DELETE', async (t) => {
    const acc = await aCustomerAccount();
    const created = await post('/notes', { account_id: acc.id, body: 'zzz note body' });
    assert.equal(created.status, 201);
    const id = created.body.id;
    deleteAfter(t, `/notes/${id}`);
    assert.equal((await get(`/notes/${id}`)).status, 200);
    assert.ok(listFrom((await get(`/notes?account_id=${acc.id}`)).body).some((n) => n.id === id));
    const upd = await patch(`/notes/${id}`, { body: 'zzz updated' });
    assert.equal(upd.status, 200);
    assert.match(upd.body.body, /updated/);
    const d = await del(`/notes/${id}`);
    assert.equal(d.status, 200);
    assert.equal(d.body.deleted, true);
    assert.equal((await del(`/notes/${id}`)).status, 404);
  });

  it('POST requires exactly one target (400 for zero or multiple)', async () => {
    const acc = await aCustomerAccount();
    const contact = listFrom((await get('/contacts?limit=1')).body)[0];
    assert.equal((await post('/notes', { body: 'no target' })).status, 400);
    assert.equal((await post('/notes', { account_id: acc.id, contact_id: contact.id, body: 'two targets' })).status, 400);
  });

  it('GET /notes requires a single target filter (400 with none)', async () => {
    assert.equal((await get('/notes')).status, 400);
  });
});
