import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { get, post, uniqueSlug, uniqueName, deleteAfter } from './helpers.js';

const today = () => new Date().toISOString().slice(0, 10);

describe('Import/export — portable JSON bundle', () => {
  it('export a seeded account → bundle with one account', async () => {
    const exp = await post('/import-export/export', { slugs: ['acme-manufacturing'] });
    assert.equal(exp.status, 200);
    assert.ok(Array.isArray(exp.body.accounts));
    assert.equal(exp.body.accounts.length, 1);
  });

  it('GET single-account export; 404 for an unknown slug', async () => {
    assert.equal((await get('/import-export/accounts/acme-manufacturing')).status, 200);
    assert.equal((await get('/import-export/accounts/zzz-nope-99999')).status, 404);
  });

  it('export requires slugs (400)', async () => {
    assert.equal((await post('/import-export/export', {})).status, 400);
  });

  it('re-importing a bundle is idempotent — no duplicate accounts', async (t) => {
    // throwaway account so the seeded counts are never at risk
    const slug = uniqueSlug();
    const acc = await post('/accounts', { slug, name: 'ZZZ Export Co', domains: [`${slug}.example`] });
    deleteAfter(t, `/accounts/${acc.body.id}`);
    const before = (await get('/accounts')).body.total;
    const bundle = (await post('/import-export/export', { slugs: [slug] })).body;
    const imp = await post('/import-export/import', bundle);
    assert.equal(imp.status, 200);
    const after = (await get('/accounts')).body.total;
    assert.equal(after, before, 'idempotent re-import must not create duplicate accounts');
  });

  it('re-import preserves a meeting\'s unlinked (display-name-only) attendees', async (t) => {
    // Regression: the bundle carries only linked account-contact attendees, never
    // display_name-only rows (partner reps / teammates). The importer used to
    // DELETE every meeting_attendees row for the meeting before re-inserting the
    // resolved links, permanently wiping the local unlinked rows. The delete must
    // be scoped to contact_id IS NOT NULL so unlinked rows survive a re-import.
    const slug = uniqueSlug();
    const acc = await post('/accounts', { slug, name: 'ZZZ Attendee Co', domains: [`${slug}.example`] });
    deleteAfter(t, `/accounts/${acc.body.id}`);

    // An account contact — carried in the bundle as an attendee_ref, so import
    // takes the branch that re-establishes (and deletes) attendee links.
    const linked = await post(`/accounts/${acc.body.id}/contacts`, { full_name: uniqueName('ZZZ Linked'), kind: 'account' });
    deleteAfter(t, `/contacts/${linked.body.id}`);

    const unlinkedName = uniqueName('ZZZ Unlinked Rep');
    const m = await post('/meetings', {
      account_id: acc.body.id, date: today(), title: 'zzz-import-attendee', body: '# a',
      contact_ids: [linked.body.id], attendees: unlinkedName,
    });
    deleteAfter(t, `/meetings/${m.body.id}`);

    const hasUnlinked = (mtg) => (mtg.unlinked_attendees || []).some((u) => u.display_name === unlinkedName);
    assert.ok(hasUnlinked((await get(`/meetings/${m.body.id}`)).body), 'unlinked attendee recorded before re-import');

    // Export then re-import over the same account — the meeting matches by
    // account_id + filename and takes the UPDATE/attendee-relink path.
    const bundle = (await post('/import-export/export', { slugs: [slug] })).body;
    assert.equal((await post('/import-export/import', bundle)).status, 200);

    assert.ok(
      hasUnlinked((await get(`/meetings/${m.body.id}`)).body),
      'unlinked attendee must survive a bundle re-import',
    );
  });
});
