import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apiFetch,
  buildDetailSyncPaths,
  formatLastSyncTimestamp,
  isOfflineCacheableApiPath,
  serverReachable,
} from './offline';

afterEach(() => vi.unstubAllGlobals());

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
});
