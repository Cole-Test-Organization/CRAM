const SHELL_CACHE = 'cram-shell-v2';
const API_CACHE = 'cram-api-v1';
const SHELL_PREFIX = 'cram-shell-';

function isCacheableApiPath(url) {
  const path = url.pathname.replace(/^\/api/, '');
  return [
    /^\/health$/,
    /^\/accounts(?:\/|$)/,
    /^\/contacts(?:\/|$)/,
    /^\/meetings(?:\/|$)/,
    /^\/opportunities(?:\/|$)/,
    /^\/products(?:\/|$)/,
    /^\/product-categories(?:\/|$)/,
    /^\/vendors(?:\/|$)/,
    /^\/vendor-products(?:\/|$)/,
    /^\/events(?:\/|$)/,
    /^\/notes(?:\/|$)/,
    /^\/threads(?:\/|$)/,
  ].some((pattern) => pattern.test(path));
}

async function installShell() {
  const cache = await caches.open(SHELL_CACHE);
  const root = await fetch('/', { cache: 'reload' });
  if (!root.ok) throw new Error(`Unable to cache app shell: ${root.status}`);

  const html = await root.clone().text();
  await cache.put('/', root.clone());
  await cache.put('/index.html', root.clone());

  const assetUrls = new Set([
    '/manifest.webmanifest',
    '/favicon.svg',
    '/icon-192.png',
    '/icon-512.png',
    '/apple-touch-icon.png',
  ]);
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const url = new URL(match[1], self.location.origin);
    if (url.origin === self.location.origin && !url.pathname.startsWith('/api/')) {
      assetUrls.add(url.pathname + url.search);
    }
  }

  await Promise.all([...assetUrls].map(async (url) => {
    const response = await fetch(url, { cache: 'reload' });
    if (response.ok) await cache.put(url, response);
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil(Promise.all([installShell(), self.skipWaiting()]));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(SHELL_PREFIX) && name !== SHELL_CACHE)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function navigationResponse(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
      await cache.put('/', response.clone());
    }
    return response;
  } catch {
    return (await cache.match(request, { ignoreVary: true }))
      || (await cache.match('/', { ignoreVary: true }))
      || (await cache.match('/index.html', { ignoreVary: true }))
      || Response.error();
  }
}

async function apiResponse(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response.status < 500) await cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set('X-CRAM-Offline', 'true');
      return new Response(cached.body, {
        status: cached.status,
        statusText: cached.statusText,
        headers,
      });
    }
    return new Response(JSON.stringify({
      error: 'This response was not included in the last offline sync.',
    }), {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        'X-CRAM-Offline': 'true',
      },
    });
  }
}

async function staticResponse(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigationResponse(request));
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    if (isCacheableApiPath(url)) event.respondWith(apiResponse(request));
    return;
  }

  if (url.pathname !== '/sw.js') event.respondWith(staticResponse(request));
});
