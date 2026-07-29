import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  CONFIG_FILENAME,
  loadOrCreateConfig,
  normalizeServerUrl,
  resolveServerConfig,
  serverStorageKey,
  serverUrlFromArgs,
} from '../src/config.mjs';

test('normalizes supported server URLs and preserves an optional base path', () => {
  assert.equal(normalizeServerUrl(' https://crm.example.test/ '), 'https://crm.example.test');
  assert.equal(normalizeServerUrl('http://127.0.0.1:3200/cram/'), 'http://127.0.0.1:3200/cram');
  assert.equal(normalizeServerUrl('http://localhost:3200/'), 'http://localhost:3200');
});

test('rejects unsafe or ambiguous server URLs', () => {
  assert.throws(() => normalizeServerUrl('file:///tmp/cram'), /https:\/\/ or http:\/\//);
  assert.throws(() => normalizeServerUrl('http://10.0.0.10:3200'), /only allowed for loopback/);
  assert.throws(() => normalizeServerUrl('https://user:secret@crm.example.test'), /credentials/);
  assert.throws(() => normalizeServerUrl('https://crm.example.test?tenant=one'), /query string/);
});

test('parses both command-line server URL forms', () => {
  assert.equal(serverUrlFromArgs(['electron', '.', '--server-url=https://one.test']), 'https://one.test');
  assert.equal(serverUrlFromArgs(['electron', '.', '--server-url', 'https://two.test']), 'https://two.test');
  assert.equal(serverUrlFromArgs(['electron', '.']), null);
});

test('creates a private first-run config and reads it back', async (t) => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), 'cram-client-config-'));
  t.after(() => rm(userDataPath, { recursive: true, force: true }));

  const first = await loadOrCreateConfig(userDataPath, 'https://first.test/');
  const second = await loadOrCreateConfig(userDataPath, 'https://ignored.test');
  const persisted = JSON.parse(await readFile(path.join(userDataPath, CONFIG_FILENAME), 'utf8'));

  assert.equal(first.serverUrl, 'https://first.test');
  assert.deepEqual(second, first);
  assert.deepEqual(persisted, { serverUrl: 'https://first.test' });
});

test('uses command line, environment, then config precedence', async (t) => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), 'cram-client-precedence-'));
  t.after(() => rm(userDataPath, { recursive: true, force: true }));
  await writeFile(
    path.join(userDataPath, CONFIG_FILENAME),
    JSON.stringify({ serverUrl: 'https://stored.test' }),
  );

  const commandLine = await resolveServerConfig({
    argv: ['electron', '.', '--server-url=https://argument.test'],
    env: { CRAM_SERVER_URL: 'https://environment.test' },
    userDataPath,
  });
  const environment = await resolveServerConfig({
    argv: ['electron', '.'],
    env: { CRAM_SERVER_URL: 'https://environment.test' },
    userDataPath,
  });
  const stored = await resolveServerConfig({
    argv: ['electron', '.'],
    env: {},
    userDataPath,
  });

  assert.equal(commandLine.serverUrl, 'https://argument.test');
  assert.equal(commandLine.source, 'command-line');
  assert.equal(environment.serverUrl, 'https://environment.test');
  assert.equal(environment.source, 'environment');
  assert.equal(stored.serverUrl, 'https://stored.test');
  assert.equal(stored.source, 'config');
});

test('isolates persistent renderer storage by normalized server URL', () => {
  assert.equal(serverStorageKey('https://one.test/'), serverStorageKey('https://one.test'));
  assert.notEqual(serverStorageKey('https://one.test'), serverStorageKey('https://two.test'));
});
