import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createFileResponseCache,
  isDesktopCacheKey,
} from '../src/response-cache.mjs';

const ACCOUNT_KEY = 'cram://app/api/accounts?sort=name';
const CONTACT_KEY = 'cram://app/api/contacts/7';

function cachedResponse(body) {
  return {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    bodyBase64: Buffer.from(JSON.stringify(body)).toString('base64'),
  };
}

test('admits core CRM keys and rejects secret or foreign origins', () => {
  assert.equal(isDesktopCacheKey(ACCOUNT_KEY), true);
  assert.equal(isDesktopCacheKey('cram://app/api/threads?account_id=7'), true);
  assert.equal(isDesktopCacheKey('cram://app/api/provisioning/secrets'), false);
  assert.equal(isDesktopCacheKey('cram://app/api/backup/settings'), false);
  assert.equal(isDesktopCacheKey('https://crm.example.test/api/accounts'), false);
});

test('persists exact responses and an endpoint-local key index', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cram-response-cache-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cache = createFileResponseCache({ directory });

  await Promise.all([
    cache.put(ACCOUNT_KEY, cachedResponse({ accounts: [{ id: 1 }] })),
    cache.put(CONTACT_KEY, cachedResponse({ id: 7 })),
  ]);
  assert.deepEqual(await cache.get(ACCOUNT_KEY), cachedResponse({ accounts: [{ id: 1 }] }));
  assert.deepEqual(await cache.keys(), [ACCOUNT_KEY, CONTACT_KEY]);

  const reopened = createFileResponseCache({ directory });
  assert.deepEqual(await reopened.keys(), [ACCOUNT_KEY, CONTACT_KEY]);
  assert.deepEqual(await reopened.get(CONTACT_KEY), cachedResponse({ id: 7 }));
  assert.match(await readFile(path.join(directory, 'index.json'), 'utf8'), /cram:\/\/app\/api\/contacts/);
  if (process.platform !== 'win32') {
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
  }
});

test('prunes stale responses without touching the retained snapshot', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cram-response-prune-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cache = createFileResponseCache({ directory });
  await cache.put(ACCOUNT_KEY, cachedResponse({ accounts: [] }));
  await cache.put(CONTACT_KEY, cachedResponse({ id: 7 }));

  await cache.prune([CONTACT_KEY]);

  assert.deepEqual(await cache.keys(), [CONTACT_KEY]);
  assert.equal(await cache.get(ACCOUNT_KEY), null);
  assert.deepEqual(await cache.get(CONTACT_KEY), cachedResponse({ id: 7 }));
});

test('rejects non-cacheable writes and malformed cached responses', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cram-response-invalid-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cache = createFileResponseCache({ directory });

  await assert.rejects(
    cache.put('cram://app/api/provisioning/secrets', cachedResponse({ secret: true })),
    /non-cacheable/,
  );
  await assert.rejects(
    cache.put(ACCOUNT_KEY, { ...cachedResponse({}), status: 999 }),
    /HTTP status/,
  );
});
