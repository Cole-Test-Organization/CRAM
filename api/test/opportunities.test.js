import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { get, post, patch, del, listFrom, deleteAfter, aCustomerAccount, aPartnerAccount } from './helpers.js';

async function makeOpp(t, accountId, extra = {}) {
  const res = await post('/opportunities', { account_id: accountId, name: 'ZZZ Test Opp', ...extra });
  if (res.body?.id) deleteAfter(t, `/opportunities/${res.body.id}`);
  return res;
}

describe('Opportunities — CRUD + rules', () => {
  it('POST creates on a customer account (201), default stage', async (t) => {
    const acc = await aCustomerAccount();
    const res = await makeOpp(t, acc.id);
    assert.equal(res.status, 201);
    assert.equal(res.body.stage, 'opp_identification');
    assert.equal(res.body.account_id, acc.id);
    assert.ok(res.body.id);
  });

  it('POST requires account_id and name (400)', async () => {
    const acc = await aCustomerAccount();
    assert.equal((await post('/opportunities', { name: 'No account' })).status, 400);
    assert.equal((await post('/opportunities', { account_id: acc.id })).status, 400);
  });

  it('POST rejects an invalid stage (400)', async () => {
    const acc = await aCustomerAccount();
    assert.equal((await post('/opportunities', { account_id: acc.id, name: 'X', stage: 'bogus_stage' })).status, 400);
  });

  it('POST rejects a partner account (400, mentions partner)', async () => {
    const partner = await aPartnerAccount();
    const res = await post('/opportunities', { account_id: partner.id, name: 'Should fail' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /partner/i);
  });

  it('POST on a nonexistent account → 404', async () => {
    assert.equal((await post('/opportunities', { account_id: 99999999, name: 'Ghost' })).status, 404);
  });

  it('PATCH updates the stage', async (t) => {
    const acc = await aCustomerAccount();
    const opp = await makeOpp(t, acc.id);
    const res = await patch(`/opportunities/${opp.body.id}`, { stage: 'tech_discovery' });
    assert.equal(res.status, 200);
    assert.equal(res.body.stage, 'tech_discovery');
  });

  it('link / unlink a product; link a nonexistent product → 404', async (t) => {
    const acc = await aCustomerAccount();
    const opp = await makeOpp(t, acc.id);
    const product = listFrom((await get('/products?limit=1')).body)[0];
    const linked = await post(`/opportunities/${opp.body.id}/products/${product.id}`, {});
    assert.equal(linked.status, 200);
    assert.ok(linked.body.products.some((p) => p.id === product.id));
    const unlinked = await del(`/opportunities/${opp.body.id}/products/${product.id}`);
    assert.equal(unlinked.status, 200);
    assert.ok(!unlinked.body.products.some((p) => p.id === product.id));
    assert.equal((await post(`/opportunities/${opp.body.id}/products/99999999`, {})).status, 404);
  });

  it('account-scoped list includes the account’s opps', async () => {
    const acme = (await get('/accounts/by-slug/acme-manufacturing')).body;
    const res = await get(`/accounts/${acme.id}/opportunities`);
    assert.equal(res.status, 200);
    assert.ok(listFrom(res.body).length >= 1);
  });

  it('total respects the stage filter (drops opps in other stages)', async (t) => {
    const acc = await aCustomerAccount();
    // Seed data spreads opps across many stages, so a single-stage count must be
    // strictly smaller than the unfiltered count.
    await makeOpp(t, acc.id, { stage: 'pov_planning' });

    const all = await get('/opportunities?limit=500');
    assert.equal(all.status, 200);
    const filtered = await get('/opportunities?stage=pov_planning&limit=500');
    assert.equal(filtered.status, 200);

    // The bug ignored stage in the count, so filtered.total equalled all.total.
    assert.ok(filtered.body.total < all.body.total, 'stage filter must shrink the total');
    assert.equal(filtered.body.total, listFrom(filtered.body).length);
    assert.ok(listFrom(filtered.body).every((o) => o.stage === 'pov_planning'));
  });

  it('DELETE returns the name; a second delete 404s', async () => {
    const acc = await aCustomerAccount();
    const { body } = await post('/opportunities', { account_id: acc.id, name: 'ZZZ Delete Opp' });
    const res = await del(`/opportunities/${body.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.deleted, true);
    assert.equal((await del(`/opportunities/${body.id}`)).status, 404);
  });
});
