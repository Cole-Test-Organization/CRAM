import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { get, post, put, patch, del, uniqueEmail, uniqueName, deleteAfter, makeAccount, aCustomerAccount } from './helpers.js';

async function makeContact(t, data) {
  const res = await post('/contacts', data);
  if (res.body?.id) deleteAfter(t, `/contacts/${res.body.id}`);
  return res;
}

describe('Contacts — CRUD + dedupe', () => {
  it('POST creates a standalone contact (201)', async (t) => {
    const full_name = uniqueName('ZZZ Contact');
    const res = await makeContact(t, { full_name, kind: 'internal' });
    assert.equal(res.status, 201);
    assert.equal(res.body.full_name, full_name);
    assert.ok(res.body.id);
  });

  it('POST with neither email nor full_name → 400', async () => {
    assert.equal((await post('/contacts', { title: 'Nobody' })).status, 400);
  });

  it('POST a duplicate email → 409 with the existing row', async (t) => {
    const email = uniqueEmail();
    await makeContact(t, { full_name: uniqueName('ZZZ Dup'), email });
    const dup = await post('/contacts', { full_name: uniqueName('ZZZ Dup2'), email });
    assert.equal(dup.status, 409);
    assert.ok(dup.body.existing);
  });

  it('PATCH and PUT update a contact', async (t) => {
    const { body } = await makeContact(t, { full_name: uniqueName('ZZZ Edit'), kind: 'internal' });
    const patched = await patch(`/contacts/${body.id}`, { title: 'VP Testing' });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.title, 'VP Testing');
    const replaced = await put(`/contacts/${body.id}`, { full_name: 'ZZZ Renamed' });
    assert.equal(replaced.status, 200);
    assert.equal(replaced.body.full_name, 'ZZZ Renamed');
  });

  it('DELETE returns full_name; a second delete 404s', async () => {
    const { body } = await post('/contacts', { full_name: uniqueName('ZZZ Del Contact'), kind: 'internal' });
    const res = await del(`/contacts/${body.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.deleted, true);
    assert.equal((await del(`/contacts/${body.id}`)).status, 404);
  });
});

describe('Contacts — find-or-create (upsert + fill-blanks)', () => {
  it('creates, then matches by email without 409, filling blank fields', async (t) => {
    const email = uniqueEmail();
    const created = await post('/contacts/find-or-create', { email, kind: 'internal' });
    if (created.body?.contact?.id) deleteAfter(t, `/contacts/${created.body.contact.id}`);
    assert.equal(created.status, 201);
    assert.equal(created.body.created, true);

    const name = uniqueName('ZZZ FoC');
    const matched = await post('/contacts/find-or-create', { email, full_name: name, kind: 'internal' });
    assert.equal(matched.status, 200);
    assert.equal(matched.body.created, false);
    assert.equal(matched.body.matched_by, 'email');
    assert.equal(matched.body.enriched, true);
    assert.ok(matched.body.enriched_fields.includes('full_name'));
    assert.equal(matched.body.contact.full_name, name);
  });
});

describe('Contacts — account links', () => {
  it('link, reassign, then unlink an account', async (t) => {
    const a = await makeAccount(t, { name: 'ZZZ Link A' });
    const b = await makeAccount(t, { name: 'ZZZ Link B' });
    const { body } = await makeContact(t, { full_name: uniqueName('ZZZ Linker'), kind: 'account' });
    const id = body.id;

    assert.ok((await post(`/contacts/${id}/accounts/${a.body.id}`, {})).status < 300);
    assert.ok((await get(`/contacts/${id}`)).body.accounts.some((x) => x.id === a.body.id));

    const re = await post(`/contacts/${id}/reassign-account`, { to_account_id: b.body.id, from_account_id: a.body.id });
    assert.equal(re.status, 200);
    const linked = (await get(`/contacts/${id}`)).body.accounts.map((x) => x.id);
    assert.ok(linked.includes(b.body.id));
    assert.ok(!linked.includes(a.body.id));

    assert.ok((await del(`/contacts/${id}/accounts/${b.body.id}`)).status < 300);
    assert.ok(!(await get(`/contacts/${id}`)).body.accounts.some((x) => x.id === b.body.id));
  });
});

describe('Contacts — lookups', () => {
  it('GET /contacts/companies lists companies that have contacts', async () => {
    const res = await get('/contacts/companies');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body) && res.body.length > 0);
  });

  it('get_by_email matches a seeded contact, else 404', async () => {
    const ok = await get('/contacts/by-email/diane.yu@acmemfg.com');
    assert.equal(ok.status, 200);
    assert.match(ok.body.full_name, /Diane/);
    assert.equal((await get('/contacts/by-email/nobody@zzz-nope.example')).status, 404);
  });

  it('attendee-options requires account_id when mode=external', async () => {
    assert.equal((await get('/contacts/attendee-options?mode=external')).status, 400);
    const acc = await aCustomerAccount();
    const res = await get(`/contacts/attendee-options?mode=external&account_id=${acc.id}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.account !== undefined && res.body.partner !== undefined && res.body.internal !== undefined);
  });
});

describe('Contacts — from-emails staging', () => {
  it('resolve-emails matches a seeded contact + returns account candidates', async () => {
    const res = await post('/contacts/resolve-emails', { emails: 'diane.yu@acmemfg.com, newperson@zzz-newco.example' });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.attendees));
    assert.ok(res.body.attendees.some((a) => /acmemfg/.test(a.email || '')));
  });

  it('from-emails materializes a new account + contact (no meeting)', async (t) => {
    const domain = `zzz-fe-${Date.now().toString(36)}.example`;
    const res = await post('/contacts/from-emails', {
      account: { mode: 'new', name: uniqueName('ZZZ FromEmails Co'), domain },
      contacts: [{ mode: 'new', full_name: uniqueName('ZZZ FE Person'), email: `p@${domain}`, kind: 'account' }],
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.account_id);
    assert.ok(Array.isArray(res.body.contact_ids) && res.body.contact_ids.length === 1);
    for (const cid of res.body.contact_ids) deleteAfter(t, `/contacts/${cid}`);
    deleteAfter(t, `/accounts/${res.body.account_id}`);
  });
});
