import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  APP_URL,
  buildUpstreamUrl,
  createProtocolHandler,
  forwardedHeaders,
  requestPathForDiagnostics,
  resolveRendererPath,
} from '../src/protocol.mjs';

test('maps app API URLs onto the configured server, including a base path', () => {
  assert.equal(
    buildUpstreamUrl(
      'https://crm.example.test/cram',
      `${APP_URL}api/accounts?sort=name`,
    ),
    'https://crm.example.test/cram/api/accounts?sort=name',
  );
});

test('drops renderer-only request headers before proxying', () => {
  const headers = forwardedHeaders({
    'Content-Type': 'application/json',
    Host: 'app',
    Origin: APP_URL,
  });

  assert.equal(headers.get('content-type'), 'application/json');
  assert.equal(headers.get('host'), null);
  assert.equal(headers.get('origin'), null);
  assert.equal(headers.get('x-cram-client'), 'desktop');
});

test('diagnostic request paths expose query names but never values', () => {
  assert.equal(
    requestPathForDiagnostics(`${APP_URL}api/notes?account_id=42&token=secret`),
    '/api/notes?account_id=…&token=…',
  );
});

test('keeps renderer paths inside the packaged asset directory', () => {
  const root = path.resolve('/tmp/cram-renderer');
  assert.equal(resolveRendererPath(root, '/assets/app.js'), path.join(root, 'assets', 'app.js'));
  assert.equal(resolveRendererPath(root, '/'), path.join(root, 'index.html'));
  assert.equal(resolveRendererPath(root, '/%2e%2e/%2e%2e/etc/passwd'), null);
  assert.equal(resolveRendererPath(root, '/%E0%A4%A'), null);
});

test('serves packaged assets and falls back to the SPA shell for navigation', async (t) => {
  const rendererRoot = await mkdtemp(path.join(os.tmpdir(), 'cram-client-renderer-'));
  t.after(() => rm(rendererRoot, { recursive: true, force: true }));
  await mkdir(path.join(rendererRoot, 'assets'));
  await writeFile(path.join(rendererRoot, 'index.html'), '<main>CRAM</main>');
  await writeFile(path.join(rendererRoot, 'assets', 'app.js'), 'export const ready = true;');

  const handler = createProtocolHandler({
    rendererRoot,
    serverUrl: 'https://crm.example.test',
    fetchUpstream: () => {
      throw new Error('not expected');
    },
  });

  const asset = await handler(new Request(`${APP_URL}assets/app.js`));
  const navigation = await handler(new Request(`${APP_URL}accounts/acme`, {
    headers: { Accept: 'text/html' },
  }));
  const missingAsset = await handler(new Request(`${APP_URL}assets/missing.js`));

  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type'), /javascript/);
  assert.match(asset.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(await asset.text(), /ready = true/);
  assert.equal(navigation.status, 200);
  assert.equal(await navigation.text(), '<main>CRAM</main>');
  assert.equal(missingAsset.status, 404);
});

test('proxies API method, query, headers, and body without touching remote UI code', async (t) => {
  const rendererRoot = await mkdtemp(path.join(os.tmpdir(), 'cram-client-api-'));
  t.after(() => rm(rendererRoot, { recursive: true, force: true }));
  const calls = [];
  const handler = createProtocolHandler({
    rendererRoot,
    serverUrl: 'https://crm.example.test',
    fetchUpstream: async (url, init) => {
      calls.push({ url, init });
      return new Response('{"ok":true}', {
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  const request = new Request(`${APP_URL}api/meetings?limit=15`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"title":"Demo"}',
    duplex: 'half',
  });
  const response = await handler(request);

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://crm.example.test/api/meetings?limit=15');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.get('x-cram-client'), 'desktop');
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.equal(await new Response(calls[0].init.body).text(), '{"title":"Demo"}');
});

test('times out a stalled API proxy request and emits a sanitized diagnostic', async (t) => {
  const rendererRoot = await mkdtemp(path.join(os.tmpdir(), 'cram-client-timeout-'));
  t.after(() => rm(rendererRoot, { recursive: true, force: true }));
  const diagnostics = [];
  const handler = createProtocolHandler({
    rendererRoot,
    serverUrl: 'https://crm.example.test',
    fetchUpstream: () => new Promise(() => {}),
    apiTimeoutMs: 10,
    onDiagnostic: (...event) => diagnostics.push(event),
  });

  await assert.rejects(
    handler(new Request(`${APP_URL}api/accounts?token=do-not-log`)),
    (error) => error?.code === 'CRAM_API_TIMEOUT',
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0][0], 'error');
  assert.equal(diagnostics[0][1], 'protocol.api.failed');
  assert.equal(diagnostics[0][2].path, '/api/accounts?token=…');
  assert.doesNotMatch(JSON.stringify(diagnostics), /do-not-log/);
});
