import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { get, post, put, patch, del, uniqueName, deleteAfter, makeAccount } from './helpers.js';

async function makeAccountContact(t, accountId, name, kind = 'account') {
  const res = await post(`/accounts/${accountId}/contacts`, { full_name: name, kind });
  if (res.body?.id) deleteAfter(t, `/contacts/${res.body.id}`);
  assert.equal(res.status, 201);
  return res.body;
}

describe('Org chart — explicit account-scoped membership', () => {
  it('keeps new contacts unassigned, preserves subtrees when moving a manager, and removes only leaves', async (t) => {
    const account = await makeAccount(t, { name: 'ZZZ Org Chart Co' });
    const senior = await makeAccountContact(t, account.body.id, uniqueName('ZZZ Org Senior'));
    const manager = await makeAccountContact(t, account.body.id, uniqueName('ZZZ Org Manager'));
    const engineer = await makeAccountContact(t, account.body.id, uniqueName('ZZZ Org Engineer'));
    const director = await makeAccountContact(t, account.body.id, uniqueName('ZZZ Org Director'));

    const initial = await get(`/accounts/${account.body.id}/org-chart`);
    assert.equal(initial.status, 200);
    assert.equal(initial.body.account_id, account.body.id);
    assert.deepEqual(initial.body.nodes, []);
    assert.deepEqual(initial.body.edges, []);
    assert.deepEqual(initial.body.root_contact_ids, []);
    assert.ok(initial.body.contacts.some((contact) => contact.id === senior.id));
    assert.ok(initial.body.contacts.some((contact) => contact.id === manager.id));
    assert.ok(initial.body.contacts.some((contact) => contact.id === engineer.id));
    assert.ok(initial.body.contacts.some((contact) => contact.id === director.id));

    // Selecting an unassigned manager intentionally materializes that manager
    // as a root; unrelated account contacts remain out of the chart.
    const setManager = await patch(`/accounts/${account.body.id}/org-chart/contacts/${manager.id}`, {
      reports_to_contact_id: senior.id,
    });
    assert.equal(setManager.status, 200);
    assert.deepEqual(new Set(setManager.body.nodes.map((node) => node.id)), new Set([senior.id, manager.id]));
    assert.deepEqual(setManager.body.root_contact_ids, [senior.id]);
    assert.ok(!setManager.body.nodes.some((node) => node.id === engineer.id));

    const setEngineer = await patch(`/accounts/${account.body.id}/org-chart/contacts/${engineer.id}`, {
      reports_to_contact_id: manager.id,
    });
    assert.equal(setEngineer.status, 200);

    const setDirectorRoot = await patch(`/accounts/${account.body.id}/org-chart/contacts/${director.id}`, {
      reports_to_contact_id: null,
    });
    assert.equal(setDirectorRoot.status, 200);
    assert.ok(setDirectorRoot.body.root_contact_ids.includes(director.id));

    // Moving the top of a chain changes only that edge. The existing manager
    // and engineer edges remain attached beneath it.
    const moved = await patch(`/accounts/${account.body.id}/org-chart/contacts/${senior.id}`, {
      reports_to_contact_id: director.id,
    });
    assert.equal(moved.status, 200);
    assert.deepEqual(new Set(moved.body.edges.map((edge) => `${edge.contact_id}:${edge.reports_to_contact_id}`)), new Set([
      `${senior.id}:${director.id}`,
      `${manager.id}:${senior.id}`,
      `${engineer.id}:${manager.id}`,
    ]));
    assert.deepEqual(moved.body.root_contact_ids, [director.id]);

    const cycle = await patch(`/accounts/${account.body.id}/org-chart/contacts/${director.id}`, {
      reports_to_contact_id: engineer.id,
    });
    assert.equal(cycle.status, 400);
    assert.match(cycle.body.error, /cycle/i);

    const blockedRemoval = await del(`/accounts/${account.body.id}/org-chart/contacts/${manager.id}`);
    assert.equal(blockedRemoval.status, 409);
    assert.match(blockedRemoval.body.error, /direct reports/i);

    const removedLeaf = await del(`/accounts/${account.body.id}/org-chart/contacts/${engineer.id}`);
    assert.equal(removedLeaf.status, 200);
    assert.ok(!removedLeaf.body.nodes.some((node) => node.id === engineer.id));
    assert.ok(removedLeaf.body.contacts.some((contact) => contact.id === engineer.id));
  });

  it('replaces roots and edges without turning omitted contacts into roots', async (t) => {
    const account = await makeAccount(t, { name: 'ZZZ Org Replace Co' });
    const root = await makeAccountContact(t, account.body.id, uniqueName('ZZZ Org Root'));
    const report = await makeAccountContact(t, account.body.id, uniqueName('ZZZ Org Report'));
    const omitted = await makeAccountContact(t, account.body.id, uniqueName('ZZZ Org Omitted'));

    const replace = await put(`/accounts/${account.body.id}/org-chart`, {
      root_contact_ids: [root.id],
      edges: [{ contact_id: report.id, reports_to_contact_id: root.id }],
    });
    assert.equal(replace.status, 200);
    assert.deepEqual(new Set(replace.body.nodes.map((node) => node.id)), new Set([root.id, report.id]));
    assert.deepEqual(replace.body.root_contact_ids, [root.id]);
    assert.ok(!replace.body.nodes.some((node) => node.id === omitted.id));
    assert.ok(replace.body.contacts.some((contact) => contact.id === omitted.id));

    const rootAndReport = await put(`/accounts/${account.body.id}/org-chart`, {
      root_contact_ids: [report.id],
      edges: [{ contact_id: report.id, reports_to_contact_id: root.id }],
    });
    assert.equal(rootAndReport.status, 400);
    assert.match(rootAndReport.body.error, /both a root and a report/i);

    const clear = await put(`/accounts/${account.body.id}/org-chart`, { root_contact_ids: [], edges: [] });
    assert.equal(clear.status, 200);
    assert.deepEqual(clear.body.nodes, []);
    assert.equal(clear.body.contacts.length, 3);
  });

  it('excludes internal support contacts from both the chart and contact pool', async (t) => {
    const account = await makeAccount(t, { name: 'ZZZ Org Internal Co' });
    const external = await makeAccountContact(t, account.body.id, uniqueName('ZZZ Org External'));
    const internal = await makeAccountContact(t, account.body.id, uniqueName('ZZZ Org Internal'), 'internal');

    const chart = await get(`/accounts/${account.body.id}/org-chart`);
    assert.equal(chart.status, 200);
    assert.ok(chart.body.contacts.some((contact) => contact.id === external.id));
    assert.ok(!chart.body.contacts.some((contact) => contact.id === internal.id));
    assert.deepEqual(chart.body.nodes, []);

    const denied = await patch(`/accounts/${account.body.id}/org-chart/contacts/${internal.id}`, {
      reports_to_contact_id: external.id,
    });
    assert.equal(denied.status, 400);
    assert.match(denied.body.error, /external contact/i);
  });

  it('unassigns a dependent branch when its manager is unlinked from the account', async (t) => {
    const account = await makeAccount(t, { name: 'ZZZ Org Cascade Co' });
    const manager = await makeAccountContact(t, account.body.id, uniqueName('ZZZ Org Cascade Manager'));
    const report = await makeAccountContact(t, account.body.id, uniqueName('ZZZ Org Cascade Report'));

    const linked = await patch(`/accounts/${account.body.id}/org-chart/contacts/${report.id}`, {
      reports_to_contact_id: manager.id,
    });
    assert.equal(linked.status, 200);
    assert.equal(linked.body.nodes.length, 2);

    const unlink = await del(`/contacts/${manager.id}/accounts/${account.body.id}`);
    assert.equal(unlink.status, 200);

    const chart = await get(`/accounts/${account.body.id}/org-chart`);
    assert.equal(chart.status, 200);
    assert.ok(!chart.body.contacts.some((contact) => contact.id === manager.id));
    assert.ok(chart.body.contacts.some((contact) => contact.id === report.id));
    assert.deepEqual(chart.body.nodes, []);
    assert.deepEqual(chart.body.edges, []);
  });
});
