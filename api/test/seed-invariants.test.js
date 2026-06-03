import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { get, listFrom, SEED } from './helpers.js';

// All read-only. These pin the deterministic fixture (dev/scripts/seed-dev-data.js
// + the catalog migrations) to EXACT counts. Because the suite is serial and
// every write test self-cleans, these stay valid regardless of file order.

describe('Seed invariants', () => {
  it('health counts match the seed', async () => {
    const { status, body } = await get('/health');
    assert.equal(status, 200);
    const c = body.counts;
    assert.equal(c.accounts, SEED.customers, 'health.accounts counts customers (partners excluded)');
    assert.equal(c.partners, SEED.partners);
    assert.equal(c.contacts, SEED.contacts);
    assert.equal(c.meetings, SEED.meetings);
    assert.equal(c.internal, SEED.internalMeetings);
    assert.equal(c.opportunities, SEED.opportunities);
  });

  it('accounts: 15 total = 10 customers + 5 partners, partition exact', async () => {
    const all = await get('/accounts');
    assert.equal(all.status, 200);
    assert.equal(all.body.total, SEED.accounts);
    const customers = await get('/accounts?exclude_status=partner');
    const partners = await get('/accounts?status=partner');
    assert.equal(customers.body.total, SEED.customers);
    assert.equal(partners.body.total, SEED.partners);
    assert.equal(customers.body.total + partners.body.total, all.body.total);
    for (const p of partners.body.accounts) assert.equal(p.status, 'partner');
    for (const c of customers.body.accounts) assert.notEqual(c.status, 'partner');
  });

  it('contacts: 32 total = 22 account + 7 partner + 3 internal', async () => {
    assert.equal(listFrom((await get('/contacts')).body).length, SEED.contacts);
    assert.equal(listFrom((await get('/contacts?kind=account')).body).length, SEED.customerContacts);
    assert.equal(listFrom((await get('/contacts?kind=partner')).body).length, SEED.partnerContacts);
    assert.equal(listFrom((await get('/contacts?kind=internal')).body).length, SEED.internalContacts);
  });

  it('meetings: 34 total = 31 account + 3 internal, sorted date desc', async () => {
    const all = listFrom((await get('/meetings?limit=1000')).body);
    assert.equal(all.length, SEED.meetings);
    assert.equal(listFrom((await get('/meetings?internal=true&limit=1000')).body).length, SEED.internalMeetings);
    assert.equal(listFrom((await get('/meetings?internal=false&limit=1000')).body).length, SEED.accountMeetings);
    for (let i = 1; i < all.length; i++) {
      assert.ok(all[i - 1].date >= all[i].date, `not sorted desc at ${i}: ${all[i - 1].date} < ${all[i].date}`);
    }
  });

  it('opportunities: exactly 10', async () => {
    const { status, body } = await get('/opportunities?limit=500');
    assert.equal(status, 200);
    assert.equal(body.total, SEED.opportunities);
    assert.equal(body.opportunities.length, SEED.opportunities);
  });

  it('account_details: exactly the 10 customers have a tech profile (partners have none)', async () => {
    const customers = (await get('/accounts?exclude_status=partner')).body.accounts;
    let withDetails = 0;
    for (const acc of customers) {
      if ((await get(`/accounts/${acc.id}/details`)).status === 200) withDetails++;
    }
    assert.equal(withDetails, SEED.accountDetails);
    const partner = (await get('/accounts?status=partner&limit=1')).body.accounts[0];
    assert.equal((await get(`/accounts/${partner.id}/details`)).status, 404);
  });

  it('partnerships: exactly 7 partner links across customer accounts', async () => {
    const customers = (await get('/accounts?exclude_status=partner')).body.accounts;
    let links = 0;
    for (const acc of customers) {
      links += listFrom((await get(`/accounts/${acc.id}/partners`)).body).length;
    }
    assert.equal(links, SEED.partnerships);
  });

  it('catalogs: seeded products / categories / themes / vendors / vendor-products', async () => {
    assert.equal(listFrom((await get('/products')).body).length, 24, 'seeded products (migration 12)');
    assert.equal(listFrom((await get('/product-categories')).body).length, 5);
    assert.equal(listFrom((await get('/themes')).body).length, 5, 'five built-in themes (migration 26)');
    assert.equal(listFrom((await get('/vendors')).body).length, 75, 'seeded vendors (migration 14)');
    assert.equal(listFrom((await get('/vendor-products')).body).length, 180, 'seeded vendor_products (migration 14)');
  });
});
