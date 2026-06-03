import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { get, post, put, patch, del, listFrom, uniqueSlug, uniqueName, deleteAfter, makeAccount } from './helpers.js';

describe('Accounts — CRUD', () => {
  it('POST creates an account (201), defaulting status=account', async (t) => {
    const slug = uniqueSlug();
    const { status, body } = await post('/accounts', { slug, name: 'ZZZ Test Co' });
    if (body?.id) deleteAfter(t, `/accounts/${body.id}`);
    assert.equal(status, 201);
    assert.equal(body.slug, slug);
    assert.equal(body.name, 'ZZZ Test Co');
    assert.equal(body.status, 'account');
    assert.ok(body.id);
  });

  it('POST rejects missing required fields (400)', async () => {
    assert.equal((await post('/accounts', { name: 'No Slug' })).status, 400);
    assert.equal((await post('/accounts', { slug: uniqueSlug() })).status, 400);
  });

  it('POST rejects an invalid slug pattern (400)', async () => {
    assert.equal((await post('/accounts', { slug: 'Not A Slug', name: 'X' })).status, 400);
  });

  it('POST a duplicate slug returns 409', async (t) => {
    const slug = uniqueSlug();
    const first = await post('/accounts', { slug, name: 'First' });
    deleteAfter(t, `/accounts/${first.body.id}`);
    assert.equal((await post('/accounts', { slug, name: 'Second' })).status, 409);
  });

  it('GET by id / slug / domain, and the 404s', async (t) => {
    const { body } = await makeAccount(t, { domains: ['zzztestco.example'] });
    assert.equal((await get(`/accounts/${body.id}`)).body.slug, body.slug);
    assert.equal((await get(`/accounts/by-slug/${body.slug}`)).status, 200);
    const byDomain = await get('/accounts/by-domain/zzztestco.example');
    assert.equal(byDomain.status, 200);
    assert.equal(byDomain.body.id, body.id);
    assert.equal((await get('/accounts/by-slug/nope-not-real-12345')).status, 404);
    assert.equal((await get('/accounts/by-domain/nope-not-real-12345.example')).status, 404);
    assert.equal((await get('/accounts/99999999')).status, 404);
  });

  it('PATCH updates only the provided fields', async (t) => {
    const { body } = await makeAccount(t);
    const res = await patch(`/accounts/${body.id}`, { relationship_summary: 'Updated summary' });
    assert.equal(res.status, 200);
    assert.equal(res.body.relationship_summary, 'Updated summary');
    assert.equal(res.body.slug, body.slug);
  });

  it('PUT replaces (slug + name required)', async (t) => {
    const { body } = await makeAccount(t);
    const ok = await put(`/accounts/${body.id}`, { slug: body.slug, name: 'Renamed' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.name, 'Renamed');
    assert.equal((await put(`/accounts/${body.id}`, { name: 'No Slug' })).status, 400);
  });

  it('DELETE returns the deleted slug; a second delete 404s', async () => {
    const slug = uniqueSlug();
    const { body } = await post('/accounts', { slug, name: 'To Delete' });
    const res = await del(`/accounts/${body.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.deleted, true);
    assert.equal(res.body.slug, slug);
    assert.equal((await del(`/accounts/${body.id}`)).status, 404);
  });
});

describe('Accounts — filters', () => {
  it('status / exclude_status partition by partner', async () => {
    for (const a of (await get('/accounts?status=partner')).body.accounts) assert.equal(a.status, 'partner');
    for (const a of (await get('/accounts?exclude_status=partner')).body.accounts) assert.notEqual(a.status, 'partner');
  });

  it('needs_review filter is exact', async (t) => {
    const { body } = await post('/accounts', { slug: uniqueSlug(), name: 'Flagged', needs_review: true });
    deleteAfter(t, `/accounts/${body.id}`);
    assert.ok((await get('/accounts?needs_review=true')).body.accounts.some((a) => a.id === body.id));
    assert.ok(!(await get('/accounts?needs_review=false')).body.accounts.some((a) => a.id === body.id));
  });
});

describe('Accounts — partner link / unlink', () => {
  it('links a partner, lists it, unlinks it', async (t) => {
    const customer = await makeAccount(t, { name: 'ZZZ Customer' });
    const partner = await makeAccount(t, { name: 'ZZZ Partner', status: 'partner' });
    const link = await post(`/accounts/${customer.body.id}/partners/${partner.body.id}`, {});
    assert.ok(link.status >= 200 && link.status < 300, `link status ${link.status}`);
    assert.ok(listFrom((await get(`/accounts/${customer.body.id}/partners`)).body).some((p) => p.id === partner.body.id));
    const unlink = await del(`/accounts/${customer.body.id}/partners/${partner.body.id}`);
    assert.ok(unlink.status >= 200 && unlink.status < 300);
    assert.ok(!listFrom((await get(`/accounts/${customer.body.id}/partners`)).body).some((p) => p.id === partner.body.id));
  });
});

describe('Accounts — find-existing / find-or-create', () => {
  it('find-existing matches a seeded slug, else 404', async () => {
    const slug = (await get('/accounts?limit=1')).body.accounts[0].slug;
    const match = await post('/accounts/find-existing', { slug });
    assert.equal(match.status, 200);
    assert.equal(match.body.slug, slug);
    assert.equal((await post('/accounts/find-existing', { slug: 'zzz-nope-99999' })).status, 404);
  });

  it('find-or-create: matched / none / created', async (t) => {
    const seeded = (await get('/accounts?limit=1')).body.accounts[0];
    const matched = await post('/accounts/find-or-create', { slug: seeded.slug });
    assert.equal(matched.status, 200);
    assert.equal(matched.body.status, 'matched');

    const none = await post('/accounts/find-or-create', { name: uniqueName('ZZZ Nonexistent Co'), fuzzy: false });
    assert.equal(none.status, 200);
    assert.equal(none.body.status, 'none');

    const created = await post('/accounts/find-or-create', { name: uniqueName('ZZZ Created Co'), fuzzy: false, create_if_missing: true });
    if (created.body?.account?.id) deleteAfter(t, `/accounts/${created.body.account.id}`);
    assert.equal(created.status, 201);
    assert.equal(created.body.status, 'created');
  });
});
