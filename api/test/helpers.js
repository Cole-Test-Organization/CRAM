// Shared HTTP client + fixtures for the API integration suite.
//
// Every test file imports from here. The suite runs SERIALLY
// (`node --test --test-concurrency=1`) against ONE live, seeded API booted by
// dev/scripts/run-api-tests.js. There is no per-test DB reset, so any test that
// writes MUST clean up after itself — name throwaway rows with a `zzz-test-`
// prefix (uniqueSlug/uniqueEmail/uniqueName) and register deleteAfter(t, …) so
// the seeded counts in seed-invariants.test.js stay exact.

const BASE = process.env.API_URL || 'http://localhost:3200/api';

async function request(method, path, payload) {
  const opts = { method, headers: {} };
  if (payload !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(payload);
  }
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  return { status: res.status, body };
}

export const get = (path) => request('GET', path);
export const post = (path, body = {}) => request('POST', path, body);
export const put = (path, body = {}) => request('PUT', path, body);
export const patch = (path, body = {}) => request('PATCH', path, body);
export const del = (path) => request('DELETE', path);
export { BASE };

// Pull the first array out of a response body — tolerates both bare arrays and
// envelope shapes ({accounts:[…]}, {products:[…]}, {opportunities:[…]}, …).
export function listFrom(body) {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object') {
    for (const v of Object.values(body)) if (Array.isArray(v)) return v;
  }
  throw new Error(`No array in response: ${JSON.stringify(body)?.slice(0, 160)}`);
}

// Exact counts produced by dev/scripts/seed-dev-data.js against a fresh DB.
// Keep in lockstep with that script — if you change the seed, change these.
export const SEED = {
  accounts: 15, // 10 customers + 5 partners
  customers: 10,
  partners: 5,
  contacts: 32, // 22 customer + 7 partner + 3 internal
  customerContacts: 22,
  partnerContacts: 7,
  internalContacts: 3,
  opportunities: 10,
  meetings: 34, // 31 account + 3 internal
  accountMeetings: 31,
  internalMeetings: 3,
  accountDetails: 10,
  partnerships: 7,
};

// Monotonic suffix so parallel-safe-ish unique ids never collide within a run.
let _seq = 0;
const stamp = () => `${Date.now().toString(36)}${(_seq += 1).toString(36)}`;

// Slug matching the accounts route pattern ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$.
export const uniqueSlug = (prefix = 'zzz-test') => `${prefix}-${stamp()}`;
export const uniqueEmail = (prefix = 'zzztest') => `${prefix}.${stamp()}@zzz-test.example`;
export const uniqueName = (prefix = 'ZZZ Test') => `${prefix} ${stamp()}`;

// Best-effort cleanup: DELETE the given path after the current test finishes,
// even if the test threw. Ignores the response (the row may already be gone,
// e.g. cascaded by a parent delete).
export function deleteAfter(t, path) {
  t.after(async () => { try { await del(path); } catch { /* best effort */ } });
}

// Fixture getters — pull a known-seeded row by category at call time.
export async function aCustomerAccount() {
  const { body } = await get('/accounts?exclude_status=partner&limit=1');
  return body.accounts[0];
}
export async function aPartnerAccount() {
  const { body } = await get('/accounts?status=partner&limit=1');
  return body.accounts[0];
}

// Create a throwaway customer account, registered for cleanup. Returns the
// created account body (has id, slug, …).
export async function makeAccount(t, overrides = {}) {
  const slug = overrides.slug || uniqueSlug();
  const { status, body } = await post('/accounts', { slug, name: overrides.name || uniqueName('ZZZ Acct'), ...overrides });
  if (status === 201 && body?.id) deleteAfter(t, `/accounts/${body.id}`);
  return { status, body };
}
