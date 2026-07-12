import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { get, post, put, patch, del, uniqueName, deleteAfter, makeAccount } from './helpers.js';

async function makeAccountContact(t, accountId, name, kind = 'account') {
  const res = await post(`/accounts/${accountId}/contacts`, { full_name: name, kind });
  if (res.body?.id) deleteAfter(t, `/contacts/${res.body.id}`);
  assert.equal(res.status, 201);
  return res.body;
}

describe('Org chart — account-scoped reporting edges', () => {
  it('reads nodes, writes edges, rejects cycles, and clears roots', async (t) => {
    const account = await makeAccount(t, { name: 'ZZZ Org Chart Co' });
    const ceo = await makeAccountContact(t, account.body.id, uniqueName('ZZZ Org CEO'));
    const manager = await makeAccountContact(t, account.body.id, uniqueName('ZZZ Org Manager'));
    const rep = await makeAccountContact(t, account.body.id, uniqueName('ZZZ Org Rep'));

    const initial = await get(`/accounts/${account.body.id}/org-chart`);
    assert.equal(initial.status, 200);
    assert.equal(initial.body.account_id, account.body.id);
    assert.ok(initial.body.nodes.some((node) => node.id === ceo.id));
    assert.ok(initial.body.nodes.some((node) => node.id === manager.id));
    assert.ok(initial.body.nodes.some((node) => node.id === rep.id));
    assert.deepEqual(initial.body.edges, []);

    const setManager = await patch(`/accounts/${account.body.id}/org-chart/contacts/${manager.id}`, {
      reports_to_contact_id: ceo.id,
    });
    assert.equal(setManager.status, 200);
    assert.ok(setManager.body.edges.some((edge) => edge.contact_id === manager.id && edge.reports_to_contact_id === ceo.id));

    const replace = await put(`/accounts/${account.body.id}/org-chart`, {
      edges: [
        { contact_id: manager.id, reports_to_contact_id: ceo.id },
        { contact_id: rep.id, reports_to_contact_id: manager.id },
      ],
    });
    assert.equal(replace.status, 200);
    assert.equal(replace.body.edges.length, 2);

    const cycle = await patch(`/accounts/${account.body.id}/org-chart/contacts/${ceo.id}`, {
      reports_to_contact_id: rep.id,
    });
    assert.equal(cycle.status, 400);
    assert.match(cycle.body.error, /cycle/i);

    const clear = await patch(`/accounts/${account.body.id}/org-chart/contacts/${rep.id}`, {
      reports_to_contact_id: null,
    });
    assert.equal(clear.status, 200);
    assert.ok(!clear.body.edges.some((edge) => edge.contact_id === rep.id));
  });

  it('excludes internal support contacts from the org chart', async (t) => {
    const account = await makeAccount(t, { name: 'ZZZ Org Internal Co' });
    const external = await makeAccountContact(t, account.body.id, uniqueName('ZZZ Org External'));
    const internal = await makeAccountContact(t, account.body.id, uniqueName('ZZZ Org Internal'), 'internal');

    const chart = await get(`/accounts/${account.body.id}/org-chart`);
    assert.equal(chart.status, 200);
    assert.ok(chart.body.nodes.some((node) => node.id === external.id));
    assert.ok(!chart.body.nodes.some((node) => node.id === internal.id));

    const denied = await patch(`/accounts/${account.body.id}/org-chart/contacts/${internal.id}`, {
      reports_to_contact_id: external.id,
    });
    assert.equal(denied.status, 400);
    assert.match(denied.body.error, /external contact/i);
  });

  it('cascades edges when a contact is unlinked from the account', async (t) => {
    const account = await makeAccount(t, { name: 'ZZZ Org Cascade Co' });
    const manager = await makeAccountContact(t, account.body.id, uniqueName('ZZZ Org Cascade Manager'));
    const report = await makeAccountContact(t, account.body.id, uniqueName('ZZZ Org Cascade Report'));

    const linked = await patch(`/accounts/${account.body.id}/org-chart/contacts/${report.id}`, {
      reports_to_contact_id: manager.id,
    });
    assert.equal(linked.status, 200);
    assert.equal(linked.body.edges.length, 1);

    const unlink = await del(`/contacts/${report.id}/accounts/${account.body.id}`);
    assert.equal(unlink.status, 200);

    const chart = await get(`/accounts/${account.body.id}/org-chart`);
    assert.equal(chart.status, 200);
    assert.ok(!chart.body.nodes.some((node) => node.id === report.id));
    assert.ok(!chart.body.edges.some((edge) => edge.contact_id === report.id));
  });
});
