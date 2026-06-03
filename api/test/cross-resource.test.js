import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { get, post, del, uniqueName, uniqueEmail, deleteAfter, makeAccount } from './helpers.js';

const today = () => new Date().toISOString().slice(0, 10);

describe('Cross-resource invariants', () => {
  it('deleting a contact drops its links, but the meeting + account survive', async (t) => {
    const acc = await makeAccount(t, { name: 'ZZZ Cascade Co' });
    const contact = await post(`/accounts/${acc.body.id}/contacts`, { full_name: uniqueName('ZZZ Attendee'), kind: 'account', email: uniqueEmail() });
    const cid = contact.body.id;
    const meeting = await post('/meetings', { account_id: acc.body.id, date: today(), title: 'zzz-cascade', body: '# c', contact_ids: [cid] });
    const mid = meeting.body.id;
    deleteAfter(t, `/meetings/${mid}`);

    assert.ok((await get(`/meetings/${mid}`)).body.contacts.some((c) => c.id === cid), 'contact starts on the meeting');

    assert.equal((await del(`/contacts/${cid}`)).status, 200);

    const after = await get(`/meetings/${mid}`);
    assert.equal(after.status, 200, 'meeting survives the contact delete');
    assert.ok(!after.body.contacts.some((c) => c.id === cid), 'contact link dropped from the meeting');
    assert.equal((await get(`/accounts/${acc.body.id}`)).status, 200, 'account survives');
    assert.equal((await get(`/contacts/${cid}`)).status, 404, 'contact itself is gone');
  });

  it('reassign-account moves only the named link, preserving the others', async (t) => {
    const a = await makeAccount(t, { name: 'ZZZ RA-A' });
    const b = await makeAccount(t, { name: 'ZZZ RA-B' });
    const c = await makeAccount(t, { name: 'ZZZ RA-C' });
    const contact = await post('/contacts', { full_name: uniqueName('ZZZ Multi'), kind: 'account', email: uniqueEmail() });
    const cid = contact.body.id;
    deleteAfter(t, `/contacts/${cid}`);
    await post(`/contacts/${cid}/accounts/${a.body.id}`, {});
    await post(`/contacts/${cid}/accounts/${b.body.id}`, {});

    const res = await post(`/contacts/${cid}/reassign-account`, { to_account_id: c.body.id, from_account_id: a.body.id });
    assert.equal(res.status, 200);
    const ids = (await get(`/contacts/${cid}`)).body.accounts.map((x) => x.id);
    assert.ok(ids.includes(b.body.id), 'untouched link B preserved');
    assert.ok(ids.includes(c.body.id), 'destination C linked');
    assert.ok(!ids.includes(a.body.id), 'source A unlinked');
  });

  it('internal-domains guard: an internal-domain email is flagged internal and never an account candidate', async (t) => {
    const domain = `zzz-myco-${Date.now().toString(36)}.example`;
    const added = await post('/internal-domains', { domain });
    assert.equal(added.status, 201);
    deleteAfter(t, `/internal-domains/${encodeURIComponent(domain)}`);

    const res = await post('/contacts/resolve-emails', { emails: `me@${domain}, them@zzz-external-${Date.now().toString(36)}.example` });
    assert.equal(res.status, 200);
    const internalAttendee = res.body.attendees.find((a) => (a.email || '').endsWith(`@${domain}`));
    assert.ok(internalAttendee, 'the internal-domain attendee is present');
    assert.equal(internalAttendee.kind, 'internal', 'flagged kind=internal');
    assert.ok(!JSON.stringify(res.body.accounts || []).includes(domain), 'internal domain is NOT an account candidate');
  });
});
