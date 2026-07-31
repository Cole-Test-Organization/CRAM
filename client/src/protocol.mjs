import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export const APP_SCHEME = 'cram';
export const APP_HOST = 'app';
export const APP_URL = `${APP_SCHEME}://${APP_HOST}/`;
export const DEFAULT_API_TIMEOUT_MS = 15_000;

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "connect-src 'self'",
  "font-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob: https: http:",
  "manifest-src 'self'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'self'",
].join('; ');

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

const FORWARDED_HEADER_BLOCKLIST = [
  'accept-encoding',
  'content-length',
  'host',
  'origin',
  'referer',
  'sec-fetch-dest',
  'sec-fetch-mode',
  'sec-fetch-site',
  'sec-fetch-user',
];

function isApiPath(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/');
}

export function requestPathForDiagnostics(requestUrl) {
  const url = new URL(requestUrl);
  const queryKeys = [...new Set(url.searchParams.keys())].sort();
  const query = queryKeys.length
    ? `?${queryKeys.map((key) => `${encodeURIComponent(key)}=…`).join('&')}`
    : '';
  return `${url.pathname}${query}`;
}

/**
 * A 404 is a normal REST answer on this API — `/accounts/:id/details` returns
 * one for every account with no tech profile yet, which is most of them, on
 * every sync. Logging those as warnings buried the failures that matter.
 */
function responseDiagnosticLevel(status, durationMs) {
  if (status >= 500) return 'error';
  if (status === 404 && durationMs < 5_000) return 'debug';
  return 'warn';
}

function emitDiagnostic(onDiagnostic, level, event, details) {
  try {
    onDiagnostic?.(level, event, details);
  } catch {
    // Diagnostics must never break the client request path.
  }
}

export function buildUpstreamUrl(serverUrl, requestUrl) {
  const incoming = new URL(requestUrl);
  const upstream = new URL(serverUrl);
  const basePath = upstream.pathname.replace(/\/+$/, '');
  upstream.pathname = `${basePath}${incoming.pathname}` || '/';
  upstream.search = incoming.search;
  upstream.hash = '';
  return upstream.toString();
}

export function forwardedHeaders(inputHeaders) {
  const headers = new Headers(inputHeaders);
  for (const name of FORWARDED_HEADER_BLOCKLIST) headers.delete(name);
  headers.set('X-CRAM-Client', 'desktop');
  return headers;
}

export function resolveRendererPath(rendererRoot, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const relative = decoded.replace(/^\/+/, '') || 'index.html';
  const resolved = path.resolve(rendererRoot, relative);
  const fromRoot = path.relative(path.resolve(rendererRoot), resolved);
  if (!fromRoot || fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) {
    return fromRoot === '' ? path.join(rendererRoot, 'index.html') : null;
  }
  return resolved;
}

function securityHeaders(filePath) {
  const headers = new Headers({
    'Cache-Control': path.basename(filePath) === 'index.html' || path.basename(filePath) === 'sw.js'
      ? 'no-cache'
      : 'public, max-age=31536000, immutable',
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    'Content-Type': MIME_TYPES.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  });
  if (path.basename(filePath) === 'sw.js') headers.set('Service-Worker-Allowed', '/');
  return headers;
}

async function regularFile(filePath) {
  try {
    const details = await stat(filePath);
    return details.isFile();
  } catch {
    return false;
  }
}

async function staticResponse(request, rendererRoot) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const url = new URL(request.url);
  let filePath = resolveRendererPath(rendererRoot, url.pathname);
  if (!filePath) return new Response('Bad request', { status: 400 });

  if (!await regularFile(filePath)) {
    const acceptsHtml = request.headers.get('accept')?.includes('text/html');
    if (!acceptsHtml) return new Response('Not found', { status: 404 });
    filePath = path.join(rendererRoot, 'index.html');
  }

  if (!await regularFile(filePath)) {
    return new Response('Desktop renderer has not been built.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const body = request.method === 'HEAD' ? null : await readFile(filePath);
  return new Response(body, { status: 200, headers: securityHeaders(filePath) });
}

/**
 * Electron's `session.fetch` runs on undici, which rejects a `ReadableStream`
 * body unless `duplex: 'half'` is set — and a stream body cannot be replayed
 * across the `redirect: 'follow'` below. Buffering the renderer's body avoids
 * both problems, so every write reaches the upstream server intact.
 */
async function upstreamBody(request, method) {
  if (method === 'GET' || method === 'HEAD' || !request.body) return undefined;
  const buffered = await request.arrayBuffer();
  return buffered.byteLength ? buffered : undefined;
}

async function proxyApiRequest(
  request,
  serverUrl,
  fetchUpstream,
  onDiagnostic,
  apiTimeoutMs,
) {
  const method = request.method.toUpperCase();
  const path = requestPathForDiagnostics(request.url);
  const controller = new AbortController();
  const startedAt = Date.now();
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      // setTimeout is wall-clock, so a laptop that slept mid-request wakes to a
      // far larger elapsed time than the limit. Report what actually elapsed
      // rather than claiming the limit was the duration.
      const error = new Error(
        `CRAM API request exceeded its ${apiTimeoutMs}ms limit (elapsed ${Date.now() - startedAt}ms).`,
      );
      error.name = 'APIProxyTimeoutError';
      error.code = 'CRAM_API_TIMEOUT';
      controller.abort(error);
      reject(error);
    }, apiTimeoutMs);
  });

  try {
    const body = await upstreamBody(request, method);
    const response = await Promise.race([
      fetchUpstream(buildUpstreamUrl(serverUrl, request.url), {
        method,
        headers: forwardedHeaders(request.headers),
        body,
        credentials: 'include',
        redirect: 'follow',
        signal: controller.signal,
      }),
      timeoutPromise,
    ]);
    const durationMs = Date.now() - startedAt;
    if (response.status >= 400 || durationMs >= 5_000) {
      emitDiagnostic(
        onDiagnostic,
        responseDiagnosticLevel(response.status, durationMs),
        'protocol.api.response',
        { method, path, status: response.status, durationMs },
      );
    }
    return response;
  } catch (error) {
    emitDiagnostic(onDiagnostic, 'error', 'protocol.api.failed', {
      method,
      path,
      durationMs: Date.now() - startedAt,
      error,
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function createProtocolHandler({
  rendererRoot,
  serverUrl,
  fetchUpstream,
  onDiagnostic,
  apiTimeoutMs = DEFAULT_API_TIMEOUT_MS,
}) {
  if (!rendererRoot) throw new Error('rendererRoot is required.');
  if (!serverUrl) throw new Error('serverUrl is required.');
  if (typeof fetchUpstream !== 'function') throw new Error('fetchUpstream is required.');
  if (!Number.isFinite(apiTimeoutMs) || apiTimeoutMs <= 0) {
    throw new Error('apiTimeoutMs must be a positive number.');
  }

  return async (request) => {
    const url = new URL(request.url);
    if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) {
      return new Response('Not found', { status: 404 });
    }
    if (isApiPath(url.pathname)) {
      return proxyApiRequest(
        request,
        serverUrl,
        fetchUpstream,
        onDiagnostic,
        apiTimeoutMs,
      );
    }
    const response = await staticResponse(request, rendererRoot);
    if (response.status >= 400) {
      emitDiagnostic(onDiagnostic, 'error', 'protocol.renderer.response', {
        method: request.method,
        path: requestPathForDiagnostics(request.url),
        status: response.status,
      });
    }
    return response;
  };
}
