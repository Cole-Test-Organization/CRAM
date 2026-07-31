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
    // Electron's session.fetch builds an undici Request from this init, which
    // is where a streamed body is rejected. Construct one here so the stub
    // cannot accept an init that the real client would throw on.
    fetchUpstream: async (url, init) => {
      calls.push({ url, init, upstream: new Request(url, init) });
      return new Response('{"ok":true}', {
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  const request = new Request(`${APP_URL}api/meetings?limit=15`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"title":"Demo"}',
  });
  const response = await handler(request);

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://crm.example.test/api/meetings?limit=15');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.get('x-cram-client'), 'desktop');
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.equal(await new Response(calls[0].init.body).text(), '{"title":"Demo"}');
  assert.equal(await calls[0].upstream.text(), '{"title":"Demo"}');
});

test('forwards a write body undici can send without a duplex option', async (t) => {
  const rendererRoot = await mkdtemp(path.join(os.tmpdir(), 'cram-client-write-'));
  t.after(() => rm(rendererRoot, { recursive: true, force: true }));
  const calls = [];
  const handler = createProtocolHandler({
    rendererRoot,
    serverUrl: 'https://crm.example.test',
    fetchUpstream: async (url, init) => {
      // A ReadableStream body throws "duplex option is required" here, exactly
      // as it did in the packaged client when saving meeting notes.
      calls.push({ init, upstream: new Request(url, init) });
      return new Response('{"id":574}', {
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  const response = await handler(new Request(`${APP_URL}api/meetings/574`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: '{"body":"Meeting notes"}',
  }));

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.ok(!(calls[0].init.body instanceof ReadableStream));
  assert.equal(calls[0].init.duplex, undefined);
  assert.equal(await calls[0].upstream.text(), '{"body":"Meeting notes"}');
});

test('omits a request body entirely for bodyless methods', async (t) => {
  const rendererRoot = await mkdtemp(path.join(os.tmpdir(), 'cram-client-bodyless-'));
  t.after(() => rm(rendererRoot, { recursive: true, force: true }));
  const calls = [];
  const handler = createProtocolHandler({
    rendererRoot,
    serverUrl: 'https://crm.example.test',
    fetchUpstream: async (url, init) => {
      calls.push({ init, upstream: new Request(url, init) });
      return new Response(null, { status: 204 });
    },
  });

  for (const method of ['GET', 'DELETE']) {
    await handler(new Request(`${APP_URL}api/meetings/574`, { method }));
  }

  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.init.body === undefined));
});

test('keeps an expected 404 out of the warning stream but still records it', async (t) => {
  const rendererRoot = await mkdtemp(path.join(os.tmpdir(), 'cram-client-404-'));
  t.after(() => rm(rendererRoot, { recursive: true, force: true }));
  const diagnostics = [];
  const handler = createProtocolHandler({
    rendererRoot,
    serverUrl: 'https://crm.example.test',
    // `/accounts/:id/details` 404s for every account with no tech profile, so a
    // full sync produces hundreds of these. They must not bury real failures.
    fetchUpstream: async (url) => new Response('{"error":"none yet"}', {
      status: url.endsWith('/details') ? 404 : 500,
    }),
    onDiagnostic: (...event) => diagnostics.push(event),
  });

  await handler(new Request(`${APP_URL}api/accounts/7/details`));
  await handler(new Request(`${APP_URL}api/accounts/7/org-chart`));

  assert.equal(diagnostics.length, 2);
  assert.equal(diagnostics[0][0], 'debug');
  assert.equal(diagnostics[0][2].status, 404);
  assert.equal(diagnostics[1][0], 'error');
  assert.equal(diagnostics[1][2].status, 500);
});

test('reports the elapsed time a timed-out request actually took', async (t) => {
  const rendererRoot = await mkdtemp(path.join(os.tmpdir(), 'cram-client-elapsed-'));
  t.after(() => rm(rendererRoot, { recursive: true, force: true }));
  const handler = createProtocolHandler({
    rendererRoot,
    serverUrl: 'https://crm.example.test',
    fetchUpstream: () => new Promise(() => {}),
    apiTimeoutMs: 10,
  });

  await assert.rejects(
    handler(new Request(`${APP_URL}api/accounts`)),
    // A sleeping laptop wakes long past the limit, so the message must not
    // claim the limit was the duration.
    (error) => /exceeded its 10ms limit \(elapsed \d+ms\)/.test(error.message),
  );
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
