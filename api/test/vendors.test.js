import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { get, post, patch, del, listFrom, uniqueName, deleteAfter } from './helpers.js';

// vendors + vendor_products are the GLOBAL catalog (no per-user RLS). The seed
// counts (75 / 180, asserted in seed-invariants) are protected by the serial
// runner + self-cleaning: every row created here is soft-deleted afterwards,
// which removes it from the default (non-deleted) listing.
//
// find-or-create wraps the row: vendors → { created, vendor }; vendor-products
// → { created, product, vendor } (here `vendor` is the PARENT, `product` is the
// row). PATCH/restore return the row directly.

const ciscoId = async () => listFrom((await get('/vendors')).body).find((v) => v.slug === 'cisco').id;

describe('Vendors — find-or-create, update, soft-delete/restore', () => {
  it('find-or-create creates (201, needs_review) then returns the existing row (200)', async (t) => {
    const name = uniqueName('ZZZ Vendor');
    const created = await post('/vendors/find-or-create', { name });
    const vendor = created.body.vendor;
    if (vendor?.id) deleteAfter(t, `/vendors/${vendor.id}`);
    assert.equal(created.status, 201);
    assert.equal(created.body.created, true);
    assert.equal(vendor.needs_review, true);
    const again = await post('/vendors/find-or-create', { name });
    assert.equal(again.status, 200);
    assert.equal(again.body.created, false);
    assert.equal(again.body.vendor.id, vendor.id);
  });

  it('PATCH updates a vendor', async (t) => {
    const vendor = (await post('/vendors/find-or-create', { name: uniqueName('ZZZ Vendor P') })).body.vendor;
    deleteAfter(t, `/vendors/${vendor.id}`);
    const res = await patch(`/vendors/${vendor.id}`, { notes: 'hello', needs_review: false });
    assert.equal(res.status, 200);
    assert.equal(res.body.notes, 'hello');
    assert.equal(res.body.needs_review, false);
  });

  it('soft-delete hides from default list; include_deleted shows it; restore brings it back', async (t) => {
    const id = (await post('/vendors/find-or-create', { name: uniqueName('ZZZ Vendor D') })).body.vendor.id;
    deleteAfter(t, `/vendors/${id}`);
    const deleted = await del(`/vendors/${id}`);
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.deleted, true);
    assert.ok(!listFrom((await get('/vendors')).body).some((v) => v.id === id));
    assert.ok(listFrom((await get('/vendors?include_deleted=true')).body).some((v) => v.id === id));
    assert.equal((await post(`/vendors/${id}/restore`, {})).status, 200);
    assert.ok(listFrom((await get('/vendors')).body).some((v) => v.id === id));
  });

  it('GET by id 404 for a nonexistent vendor', async () => {
    assert.equal((await get('/vendors/99999999')).status, 404);
  });
});

describe('Vendor products — find-or-create, soft-delete/restore', () => {
  it('find-or-create under a seeded vendor, then existing; soft-delete/restore', async (t) => {
    const vendorId = await ciscoId();
    const name = uniqueName('ZZZ VProduct');
    const created = await post('/vendor-products/find-or-create', { vendor_id: vendorId, name, category: 'firewall' });
    assert.equal(created.status, 201);
    assert.equal(created.body.created, true);
    const id = created.body.product.id;
    deleteAfter(t, `/vendor-products/${id}`);
    const again = await post('/vendor-products/find-or-create', { vendor_id: vendorId, name, category: 'firewall' });
    assert.equal(again.status, 200);
    assert.equal(again.body.created, false);

    assert.equal((await del(`/vendor-products/${id}`)).status, 200);
    assert.ok(!listFrom((await get('/vendor-products?vendor_slug=cisco')).body).some((p) => p.id === id));
    assert.ok(listFrom((await get('/vendor-products?vendor_slug=cisco&include_deleted=true')).body).some((p) => p.id === id));
    assert.equal((await post(`/vendor-products/${id}/restore`, {})).status, 200);
  });

  it('find-or-create requires name and category (400)', async () => {
    const vendorId = await ciscoId();
    assert.equal((await post('/vendor-products/find-or-create', { vendor_id: vendorId, name: 'X' })).status, 400);
  });
});
