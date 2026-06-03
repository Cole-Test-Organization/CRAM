import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { get, post, put, del, listFrom, deleteAfter, aCustomerAccount } from './helpers.js';

const today = () => new Date().toISOString().slice(0, 10);
const aContactFor = async (accountId) => listFrom((await get(`/accounts/${accountId}/contacts`)).body)[0];

describe('Meetings — CRUD + required-field rules', () => {
  it('creates an internal note (no account/contacts needed)', async (t) => {
    const res = await post('/meetings', { internal: true, date: today(), title: 'zzz-internal', body: '# zzz internal note' });
    if (res.body?.id) deleteAfter(t, `/meetings/${res.body.id}`);
    assert.equal(res.status, 201);
    assert.equal(res.body.internal, true);
  });

  it('non-internal requires account_id and contact_ids (400)', async () => {
    assert.equal((await post('/meetings', { date: today(), body: 'x' })).status, 400);
    const acc = await aCustomerAccount();
    assert.equal((await post('/meetings', { account_id: acc.id, date: today(), body: 'x' })).status, 400);
  });

  it('creates an account meeting, GETs it, PUT updates, then DELETE', async (t) => {
    const acc = await aCustomerAccount();
    const contact = await aContactFor(acc.id);
    const created = await post('/meetings', { account_id: acc.id, date: today(), title: 'zzz-acct-mtg', body: '# zzz', contact_ids: [contact.id] });
    assert.equal(created.status, 201);
    const id = created.body.id;
    deleteAfter(t, `/meetings/${id}`);
    const got = await get(`/meetings/${id}`);
    assert.equal(got.status, 200);
    assert.ok(got.body.body);
    const upd = await put(`/meetings/${id}`, { body: '# zzz updated' });
    assert.equal(upd.status, 200);
    assert.match(upd.body.body, /updated/);
  });

  it('GET a nonexistent meeting → 404', async () => {
    assert.equal((await get('/meetings/99999999')).status, 404);
  });
});

describe('Meetings — null-times contract (regression)', () => {
  // Regression: the route once typed starts_at/ends_at as string-only, so the
  // GUI sending null ("clear it") got a 400. null must validate. We PUT a
  // nonexistent id: a passing schema reaches the service and 404s; a still-
  // rejecting schema 400s before that.
  it('PUT accepts null starts_at/ends_at/location (clear the time)', async () => {
    const res = await put('/meetings/999999', { starts_at: null, ends_at: null, location: null });
    assert.notEqual(res.status, 400, 'null must pass schema validation (regression)');
    assert.equal(res.status, 404, 'reaches the service and 404s on a nonexistent id');
  });

  it('PUT still rejects a malformed starts_at (400)', async () => {
    assert.equal((await put('/meetings/999999', { starts_at: 'not-a-timestamp' })).status, 400);
  });
});

describe('Meetings — triage (assign / reassign account)', () => {
  it('assign-account attaches a parked internal note; a second assign 409s', async (t) => {
    const acc = await aCustomerAccount();
    const note = await post('/meetings', { internal: true, date: today(), title: 'zzz-park', body: '# park' });
    const id = note.body.id;
    deleteAfter(t, `/meetings/${id}`);
    const assigned = await post(`/meetings/${id}/assign-account`, { account_id: acc.id });
    assert.equal(assigned.status, 200);
    assert.equal(assigned.body.account_id, acc.id);
    assert.equal(assigned.body.internal, false);
    assert.equal((await post(`/meetings/${id}/assign-account`, { account_id: acc.id })).status, 409);
  });

  it('reassign-account moves a meeting to a different account', async (t) => {
    const [a, b] = (await get('/accounts?exclude_status=partner&limit=2')).body.accounts;
    const contact = await aContactFor(a.id);
    const m = await post('/meetings', { account_id: a.id, date: today(), title: 'zzz-reassign', body: '# r', contact_ids: [contact.id] });
    const id = m.body.id;
    deleteAfter(t, `/meetings/${id}`);
    const res = await post(`/meetings/${id}/reassign-account`, { account_id: b.id });
    assert.equal(res.status, 200);
    assert.equal(res.body.account_id, b.id);
  });
});

describe('Meetings — link an unlinked attendee', () => {
  it('a free-text attendee becomes an unlinked row, then links to a contact', async (t) => {
    const acc = await aCustomerAccount();
    const linked = await aContactFor(acc.id);
    const m = await post('/meetings', {
      account_id: acc.id, date: today(), title: 'zzz-attendee', body: '# a',
      contact_ids: [linked.id], attendees: 'ZZZ Unlinked Person',
    });
    deleteAfter(t, `/meetings/${m.body.id}`);
    const full = (await get(`/meetings/${m.body.id}`)).body;
    const unlinked = full.unlinked_attendees || [];
    assert.ok(unlinked.length >= 1, 'free-text attendee recorded as an unlinked row');
    const attendeeId = unlinked[0].attendee_id ?? unlinked[0].id;
    const newContact = await post('/contacts', { full_name: 'ZZZ Unlinked Person', kind: 'account' });
    deleteAfter(t, `/contacts/${newContact.body.id}`);
    const res = await post(`/meetings/${m.body.id}/attendees/${attendeeId}/link`, { contact_id: newContact.body.id });
    assert.equal(res.status, 200);
  });
});
