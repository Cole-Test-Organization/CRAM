import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { get, patch, del, listFrom, makeAccount } from './helpers.js';

describe('Account details — tech profile', () => {
  it('a seeded customer has a populated profile', async () => {
    const acme = (await get('/accounts/by-slug/acme-manufacturing')).body;
    const res = await get(`/accounts/${acme.id}/details`);
    assert.equal(res.status, 200);
    assert.equal(res.body.industry, 'Manufacturing');
  });

  it('GET 404 with no row; PATCH upserts; GET expands *_ids; DELETE removes', async (t) => {
    const { body: acc } = await makeAccount(t, { name: 'ZZZ Details Co' });
    assert.equal((await get(`/accounts/${acc.id}/details`)).status, 404);

    const vp = listFrom((await get('/vendor-products?limit=1')).body)[0];
    const up = await patch(`/accounts/${acc.id}/details`, { industry: 'Testing', employee_count: 123, edr_ids: [vp.id] });
    assert.equal(up.status, 200);
    assert.equal(up.body.industry, 'Testing');
    assert.equal(up.body.employee_count, 123);

    const got = await get(`/accounts/${acc.id}/details`);
    assert.equal(got.status, 200);
    assert.deepEqual(got.body.edr_ids, [vp.id]);
    assert.ok(Array.isArray(got.body.edr_products));
    assert.equal(got.body.edr_products[0]?.id, vp.id);

    assert.equal((await get(`/accounts/${acc.id}/vendor-heatmap`)).status, 200);

    assert.equal((await del(`/accounts/${acc.id}/details`)).status, 200);
    assert.equal((await get(`/accounts/${acc.id}/details`)).status, 404);
    assert.equal((await del(`/accounts/${acc.id}/details`)).status, 404);
  });

  it('PATCH array field replaces; [] clears', async (t) => {
    const { body: acc } = await makeAccount(t, { name: 'ZZZ Details Arr' });
    const vps = listFrom((await get('/vendor-products?limit=2')).body);
    await patch(`/accounts/${acc.id}/details`, { firewall_ids: [vps[0].id, vps[1].id] });
    assert.deepEqual((await get(`/accounts/${acc.id}/details`)).body.firewall_ids, [vps[0].id, vps[1].id]);
    await patch(`/accounts/${acc.id}/details`, { firewall_ids: [] });
    assert.deepEqual((await get(`/accounts/${acc.id}/details`)).body.firewall_ids, []);
  });
});
