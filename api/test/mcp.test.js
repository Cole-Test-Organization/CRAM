// In-process MCP surface — builds the SAME server+client pair the in-app agent
// uses (api/src/agent/mcp-client.js → buildMcpSession), with no network port and
// no LLM. Two checks (TEST-SPEC.md §7, Phase 3):
//   1. Wiring — every tool's read action reaches its service without a
//      "services bag" crash (the Cannot-read-undefined bug CLAUDE.md warns of:
//      a service added to one bag but not the in-process one).
//   2. Parity — the registered tool set + key action enums, and that an HTTP
//      filter (accounts status) is reachable over MCP too.
//
// We force TODOIST_ENABLED=false so the in-process session matches the booted
// API (no todoist_tasks tool, no /todoist routes) — see run-api-tests.js.
process.env.TODOIST_ENABLED = 'false';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildMcpSession } from '../src/agent/mcp-client.js';
import { closeDb } from '../src/db/connection.js';
import { get } from './helpers.js';

const EXPECTED_TOOLS = [
  'account_details', 'accounts', 'agent_settings', 'backup', 'contacts', 'events',
  'export_markdown', 'import_export', 'internal_domains', 'meetings', 'memories',
  'notes', 'notes_import', 'opportunities', 'outreach', 'product_categories',
  'products', 'provisioning', 'search', 'threads', 'vendor_products', 'vendors',
].sort();

let session;
let ACME_ID;

before(async () => {
  session = await buildMcpSession();
  ACME_ID = (await get('/accounts/by-slug/acme-manufacturing')).body.id;
});

after(async () => {
  try { await session?.client?.close?.(); } catch { /* ignore */ }
  try { await session?.server?.close?.(); } catch { /* ignore */ }
  await closeDb(); // release this process's PG pool so node --test can exit
});

const textOf = (res) => (res.content || []).map((c) => c.text || '').join('');

describe('MCP — tool set + parity', () => {
  it('registers exactly the expected tools; todoist absent when disabled', async () => {
    const names = (await session.client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(names, EXPECTED_TOOLS);
    assert.ok(!names.includes('todoist_tasks'));
  });

  it('no /todoist HTTP routes when disabled', async () => {
    assert.equal((await get('/todoist/tasks')).status, 404);
  });

  it('key action enums are exposed (catches surface drift)', async () => {
    const tools = (await session.client.listTools()).tools;
    const actionsOf = (name) => tools.find((t) => t.name === name)?.inputSchema?.properties?.action?.enum || [];
    for (const a of ['list', 'list_full', 'create', 'update', 'delete', 'add_partner']) {
      assert.ok(actionsOf('accounts').includes(a), `accounts tool missing action "${a}"`);
    }
    for (const a of ['link_product', 'unlink_product']) assert.ok(actionsOf('opportunities').includes(a));
    assert.ok(actionsOf('vendors').includes('restore'));
    assert.ok(actionsOf('account_details').includes('vendor_heatmap'));
    for (const a of ['list_deployments', 'get_deployment', 'deploy', 'get_job', 'cancel_job', 'list_secrets']) {
      assert.ok(actionsOf('provisioning').includes(a), `provisioning tool missing action "${a}"`);
    }
    for (const a of ['list', 'create', 'update', 'delete', 'add_task', 'update_task', 'delete_task', 'link_contact', 'unlink_contact']) {
      assert.ok(actionsOf('threads').includes(a), `threads tool missing action "${a}"`);
    }
  });

  it('parity: the accounts status filter is reachable over MCP (5 partners)', async () => {
    const res = await session.client.callTool({ name: 'accounts', arguments: { action: 'list_full', status: 'partner' } });
    assert.ok(!res.isError, textOf(res));
    const data = JSON.parse(textOf(res));
    const accts = data.accounts || data;
    assert.equal(accts.length, 5);
    assert.ok(accts.every((a) => a.status === 'partner'));
  });
});

describe('MCP — wiring (every tool reaches its service)', () => {
  it('each tool answers a read action with no services-bag crash', async () => {
    const reads = [
      ['accounts', { action: 'list' }],
      ['contacts', { action: 'list' }],
      ['meetings', { action: 'list' }],
      ['opportunities', { action: 'list' }],
      ['products', { action: 'list' }],
      ['product_categories', { action: 'list' }],
      ['vendors', { action: 'list' }],
      ['vendor_products', { action: 'list' }],
      ['events', { action: 'list' }],
      ['memories', { action: 'list' }],
      ['internal_domains', { action: 'list' }],
      ['notes_import', { action: 'list_jobs' }],
      ['outreach', { action: 'stats' }],
      ['search', { query: 'acme' }],
      ['export_markdown', { slug: 'acme-manufacturing' }],
      ['import_export', { action: 'export', slugs: ['acme-manufacturing'] }],
      ['agent_settings', { action: 'get' }],
      ['backup', { action: 'get_settings' }],
      ['notes', { action: 'list', account_id: ACME_ID }],
      ['account_details', { action: 'get', account_id: ACME_ID }],
      ['threads', { action: 'list', account_id: ACME_ID }],
      ['provisioning', { action: 'list_deployments' }],
    ];
    const unwired = [];
    for (const [name, args] of reads) {
      const res = await session.client.callTool({ name, arguments: args });
      const text = textOf(res);
      if (/Cannot read propert|is not a function/i.test(text)) unwired.push(`${name}: ${text.slice(0, 140)}`);
    }
    assert.deepEqual(unwired, [], `tools missing from the in-process services bag:\n${unwired.join('\n')}`);
  });

  it('core data tools return real seeded data', async () => {
    const accounts = JSON.parse(textOf(await session.client.callTool({ name: 'accounts', arguments: { action: 'list' } })));
    assert.ok((accounts.slugs || accounts).includes('acme-manufacturing'));
    const vendors = JSON.parse(textOf(await session.client.callTool({ name: 'vendors', arguments: { action: 'list' } })));
    assert.equal((vendors.vendors || vendors).length, 75);
  });
});
