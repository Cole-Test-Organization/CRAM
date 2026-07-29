import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apiFetch,
  buildDetailSyncPaths,
  formatLastSyncTimestamp,
  hasCompleteOfflineCopy,
  isOfflineCacheableApiPath,
  serverReachable,
} from './offline';

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as Window & { cramMobile?: unknown }).cramMobile;
});

function installMobileCache(overrides: {
  get?: ReturnType<typeof vi.fn>;
  keys?: ReturnType<typeof vi.fn>;
  put?: ReturnType<typeof vi.fn>;
} = {}) {
  const cache = {
    put: overrides.put || vi.fn(async (_key: string, _response: unknown) => undefined),
    get: overrides.get || vi.fn(async (_key: string) => null),
    keys: overrides.keys || vi.fn(async () => []),
    delete: vi.fn(async () => undefined),
  };
  Object.defineProperty(window, 'cramMobile', {
    configurable: true,
    value: {
      isMobile: true,
      cache,
      openMeetingNotes: vi.fn(),
      openSettings: vi.fn(),
    },
  });
  return cache;
}

describe('offline cache boundary', () => {
  it('includes core CRM reads and excludes operational or secret-bearing surfaces', () => {
    expect(isOfflineCacheableApiPath('/api/accounts?sort=name')).toBe(true);
    expect(isOfflineCacheableApiPath('/api/accounts/7/details')).toBe(true);
    expect(isOfflineCacheableApiPath('https://notes.example.test/api/notes?account_id=7')).toBe(true);
    expect(isOfflineCacheableApiPath('/api/provisioning/secrets')).toBe(false);
    expect(isOfflineCacheableApiPath('/api/backup/settings')).toBe(false);
    expect(isOfflineCacheableApiPath('/api/agent/sessions')).toBe(false);
  });
});

describe('offline detail sync plan', () => {
  it('covers every core detail route and removes duplicate paths', () => {
    const paths = buildDetailSyncPaths({
      accounts: [{ id: 7, slug: 'acme' }, { id: 7, slug: 'acme' }],
      contacts: [{ id: 11 }],
      meetings: [{ id: 13 }],
      opportunities: [{ id: 17 }],
      events: [{ id: 19 }],
    });

    expect(paths).toContain('/api/accounts/by-slug/acme');
    expect(paths).toContain('/api/accounts/7/details');
    expect(paths).toContain('/api/accounts/7/vendor-heatmap');
    expect(paths).toContain('/api/accounts/7/org-chart');
    expect(paths).toContain('/api/accounts/7/news');
    expect(paths).toContain('/api/threads?account_id=7&include_closed=true');
    expect(paths).toContain('/api/contacts/11');
    expect(paths).toContain('/api/notes?contact_id=11&limit=500');
    expect(paths).toContain('/api/meetings/13');
    expect(paths).toContain('/api/opportunities/17');
    expect(paths).toContain('/api/events/19');
    expect(paths.filter((path) => path === '/api/accounts/by-slug/acme')).toHaveLength(1);
  });
});

describe('last sync formatting', () => {
  it('does not invent a timestamp when no valid sync exists', () => {
    expect(formatLastSyncTimestamp(null)).toBe('Never');
    expect(formatLastSyncTimestamp('not-a-date')).toBe('Never');
  });
});

describe('offline API transport', () => {
  it('persists successful CRM reads by exact request URL', async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('caches', {
      open: vi.fn().mockResolvedValue({ put, match: vi.fn() }),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"accounts":[]}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));

    const response = await apiFetch('/api/accounts?sort=name');

    expect(response.status).toBe(200);
    expect(put).toHaveBeenCalledOnce();
    const [request] = put.mock.calls[0] as [Request, Response];
    expect(request.url).toBe('http://localhost:3000/api/accounts?sort=name');
  });

  it('recognizes a service-worker replay as offline and does not recache it', async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('caches', {
      open: vi.fn().mockResolvedValue({ put, match: vi.fn() }),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', {
      status: 200,
      headers: { 'X-CRAM-Offline': 'true' },
    })));

    await apiFetch('/api/contacts');

    expect(serverReachable()).toBe(false);
    expect(put).not.toHaveBeenCalled();
  });

  it('marks a direct cache fallback as offline when DNS or the proxy is unreachable', async () => {
    const cached = new Response('{"accounts":[{"id":7}]}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    vi.stubGlobal('caches', {
      open: vi.fn().mockResolvedValue({
        put: vi.fn(),
        match: vi.fn().mockResolvedValue(cached),
      }),
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const response = await apiFetch('/api/accounts?sort=name', {}, { forceNetwork: true });

    expect(response.status).toBe(200);
    expect(response.headers.get('X-CRAM-Offline')).toBe('true');
    expect(serverReachable()).toBe(false);
  });

  it('uses the native mobile cache adapter when the Swift bridge is present', async () => {
    const put = vi.fn(async (_key: string, _response: unknown) => undefined);
    installMobileCache({ put });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"accounts":[]}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));

    await apiFetch('/api/accounts?sort=name');

    expect(put).toHaveBeenCalledOnce();
    expect(put.mock.calls[0][0]).toBe('http://localhost:3000/api/accounts?sort=name');
    expect(put.mock.calls[0][1]).toMatchObject({
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  it('reconstructs a cached mobile response after a network failure', async () => {
    const get = vi.fn(async () => ({
      status: 200,
      statusText: 'ok',
      headers: { 'Content-Type': 'application/json' },
      bodyBase64: btoa('{"accounts":[{"id":9}]}'),
    }));
    installMobileCache({ get });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const response = await apiFetch('/api/accounts?sort=name', {}, { forceNetwork: true });

    expect(response.headers.get('X-CRAM-Offline')).toBe('true');
    await expect(response.json()).resolves.toEqual({ accounts: [{ id: 9 }] });
    expect(get).toHaveBeenCalledOnce();
  });

  it('validates a persisted mobile snapshot through the native cache', async () => {
    const keys = vi.fn(async () => [
      'http://localhost:3000/api/accounts?sort=name',
      'http://localhost:3000/api/meetings?limit=15',
    ]);
    installMobileCache({ keys });
    vi.stubGlobal('caches', {
      open: vi.fn(() => {
        throw new Error('Browser CacheStorage must not be used by CRAM Mobile.');
      }),
    });

    await expect(hasCompleteOfflineCopy([
      '/api/accounts?sort=name',
      '/api/meetings?limit=15',
    ])).resolves.toBe(true);
    await expect(hasCompleteOfflineCopy([
      '/api/accounts?sort=name',
      '/api/contacts',
    ])).resolves.toBe(false);
    expect(keys).toHaveBeenCalledTimes(2);
  });
});
