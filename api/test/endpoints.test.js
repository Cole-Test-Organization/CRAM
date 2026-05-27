import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.API_URL || 'http://localhost:3200/api';

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  const body = await res.json();
  return { status: res.status, body };
}

describe('Health', () => {
  it('GET /health returns counts', async () => {
    const { status, body } = await get('/health');
    assert.equal(status, 200);
    assert.ok(typeof body.counts.accounts === 'number');
    assert.ok(typeof body.counts.contacts === 'number');
    assert.ok(typeof body.counts.meetings === 'number');
    assert.ok(typeof body.counts.internal === 'number');
    console.log('  counts:', body.counts);
  });
});

describe('Accounts', () => {
  it('GET /accounts returns all accounts', async () => {
    const { status, body } = await get('/accounts');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.accounts));
    assert.ok(body.total > 0, 'should have accounts');
    console.log('  total:', body.total);
  });

  it('GET /accounts?exclude_status=partner returns only non-partner accounts', async () => {
    const { status, body } = await get('/accounts?exclude_status=partner');
    assert.equal(status, 200);
    assert.ok(body.total > 0, 'should have non-partner accounts');
    for (const acct of body.accounts) {
      assert.notEqual(acct.status, 'partner', `${acct.name} has status "partner" but exclude_status=partner was set`);
    }
    console.log('  accounts:', body.total);
  });

  it('GET /accounts?status=partner returns only partners', async () => {
    const { status, body } = await get('/accounts?status=partner');
    assert.equal(status, 200);
    assert.ok(body.total > 0, 'should have partners');
    for (const acct of body.accounts) {
      assert.equal(acct.status, 'partner', `${acct.name} has status "${acct.status}" not "partner"`);
    }
    console.log('  partners:', body.total);
  });

  it('GET /accounts (exclude_status=partner) + status=partner = total', async () => {
    const all = await get('/accounts');
    const accounts = await get('/accounts?exclude_status=partner');
    const partners = await get('/accounts?status=partner');
    assert.equal(
      accounts.body.total + partners.body.total,
      all.body.total,
      `accounts (${accounts.body.total}) + partners (${partners.body.total}) should equal total (${all.body.total})`
    );
  });

  it('GET /accounts/by-slug/:slug returns account with contacts and meetings', async () => {
    const list = await get('/accounts?limit=1');
    const slug = list.body.accounts[0].slug;
    const { status, body } = await get(`/accounts/by-slug/${slug}`);
    assert.equal(status, 200);
    assert.equal(body.slug, slug);
    assert.ok(Array.isArray(body.contacts), 'should have contacts array');
    assert.ok(Array.isArray(body.meetings), 'should have meetings array');
    console.log(`  ${body.name}: ${body.contacts.length} contacts, ${body.meetings.length} meetings`);
  });

  it('GET /accounts/by-slug/nonexistent returns 404', async () => {
    const { status } = await get('/accounts/by-slug/this-slug-does-not-exist-12345');
    assert.equal(status, 404);
  });
});

describe('Meetings', () => {
  it('GET /meetings returns all meetings sorted by date desc', async () => {
    const { status, body } = await get('/meetings');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body), 'should be an array');
    console.log('  total meetings:', body.length);

    // Verify sorted by date descending
    for (let i = 1; i < body.length; i++) {
      assert.ok(
        body[i - 1].date >= body[i].date,
        `meetings not sorted: ${body[i - 1].date} should be >= ${body[i].date}`
      );
    }

    // Verify each meeting has account info
    for (const m of body) {
      assert.ok(m.id, 'meeting should have id');
      assert.ok(m.date, 'meeting should have date');
      assert.ok(m.account_name, `meeting ${m.id} missing account_name`);
      assert.ok(m.account_slug, `meeting ${m.id} missing account_slug`);
    }
  });

  it('GET /meetings?limit=3 respects limit', async () => {
    const { status, body } = await get('/meetings?limit=3');
    assert.equal(status, 200);
    assert.ok(body.length <= 3, `expected <= 3 meetings, got ${body.length}`);
  });

  it('GET /meetings/:id returns single meeting', async () => {
    const list = await get('/meetings?limit=1');
    if (list.body.length === 0) return; // skip if no meetings
    const id = list.body[0].id;
    const { status, body } = await get(`/meetings/${id}`);
    assert.equal(status, 200);
    assert.equal(body.id, id);
    assert.ok(body.body, 'should include meeting body');
    assert.ok(body.account_slug, 'should include account_slug');
    console.log(`  meeting ${id}: "${body.title || body.filename}" (${body.date})`);
  });

  it('GET /meetings/999999 returns 404', async () => {
    const { status } = await get('/meetings/999999');
    assert.equal(status, 404);
  });
});

describe('Contacts', () => {
  it('GET /contacts returns contacts', async () => {
    const { status, body } = await get('/contacts');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
    console.log('  total contacts:', body.length);
  });

  it('GET /contacts/companies returns company list', async () => {
    const { status, body } = await get('/contacts/companies');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
    console.log('  companies:', body.length);
  });
});

describe('Search', () => {
  it('GET /search?q=test returns results structure', async () => {
    const { status, body } = await get('/search?q=test&type=all&limit=5');
    assert.equal(status, 200);
    assert.ok(typeof body.total === 'number');
    assert.ok(body.results);
    console.log('  search "test":', body.total, 'results');
  });
});

describe('Internal', () => {
  it('GET /internal returns internal notes', async () => {
    const { status, body } = await get('/internal');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
    console.log('  internal notes:', body.length);
  });
});
