import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { get, post, patch, del, listFrom, uniqueName, deleteAfter } from './helpers.js';

describe('Products — CRUD', () => {
  it('POST creates (201); missing name → 400; duplicate name → 409', async (t) => {
    const name = uniqueName('ZZZ Product');
    const created = await post('/products', { name });
    if (created.body?.id) deleteAfter(t, `/products/${created.body.id}`);
    assert.equal(created.status, 201);
    assert.equal(created.body.name, name);
    assert.equal((await post('/products', {})).status, 400);
    assert.equal((await post('/products', { name })).status, 409);
  });

  it('create with a category, then PATCH rename', async (t) => {
    const cat = listFrom((await get('/product-categories')).body)[0];
    const created = await post('/products', { name: uniqueName('ZZZ Cat Product'), category_id: cat.id });
    deleteAfter(t, `/products/${created.body.id}`);
    assert.equal(created.status, 201);
    const renamed = uniqueName('ZZZ Renamed Product');
    const res = await patch(`/products/${created.body.id}`, { name: renamed });
    assert.equal(res.status, 200);
    assert.equal(res.body.name, renamed);
  });

  it('GET by id 404; DELETE returns name then 404', async () => {
    assert.equal((await get('/products/99999999')).status, 404);
    const { body } = await post('/products', { name: uniqueName('ZZZ Del Product') });
    const res = await del(`/products/${body.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.deleted, true);
    assert.equal((await del(`/products/${body.id}`)).status, 404);
  });

  it('total respects the search filter (counts matches, not all products)', async (t) => {
    // Two products sharing a unique token; nothing else in the catalog matches it.
    const token = uniqueName('ZZZSearchTotal').replace(/\s+/g, '');
    const a = await post('/products', { name: `${token} Alpha` });
    const b = await post('/products', { name: `${token} Beta` });
    deleteAfter(t, `/products/${a.body.id}`);
    deleteAfter(t, `/products/${b.body.id}`);

    const res = await get(`/products?search=${token}`);
    assert.equal(res.status, 200);
    // The bug counted every product; total must reflect the ILIKE filter.
    assert.equal(res.body.total, 2);
    assert.equal(res.body.total, listFrom(res.body).length);
  });
});

describe('Product categories — CRUD', () => {
  it('POST creates (201); duplicate → 409; PATCH rename', async (t) => {
    const name = uniqueName('ZZZ Category');
    const created = await post('/product-categories', { name });
    if (created.body?.id) deleteAfter(t, `/product-categories/${created.body.id}`);
    assert.equal(created.status, 201);
    assert.equal((await post('/product-categories', { name })).status, 409);
    const renamed = uniqueName('ZZZ Cat Renamed');
    const res = await patch(`/product-categories/${created.body.id}`, { name: renamed });
    assert.equal(res.status, 200);
    assert.equal(res.body.name, renamed);
  });

  it('DELETE clears the FK on member products (product survives, category null)', async (t) => {
    const cat = await post('/product-categories', { name: uniqueName('ZZZ Temp Cat') });
    const prod = await post('/products', { name: uniqueName('ZZZ Member Product'), category_id: cat.body.id });
    deleteAfter(t, `/products/${prod.body.id}`);
    assert.equal((await del(`/product-categories/${cat.body.id}`)).status, 200);
    const after = await get(`/products/${prod.body.id}`);
    assert.equal(after.status, 200);
    assert.ok(after.body.category_id == null, 'category_id cleared to null');
  });
});
