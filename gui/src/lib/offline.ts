import { createSignal } from 'solid-js';

const API_CACHE_NAME = 'cram-api-v1';
const LAST_SYNC_STORAGE_KEY = 'cram.offline-sync.v1';
const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const FOREGROUND_SYNC_STALE_MS = 60 * 1000;
const SYNC_CONCURRENCY = 6;
const OPPORTUNITY_PAGE_SIZE = 500;

export type SyncPhase = 'idle' | 'syncing' | 'ready' | 'error';

type LastSyncRecord = {
  completedAt: string;
  paths: string[];
  responseCount: number;
  version: 1;
};

type CollectionSnapshot = {
  accounts: any[];
  contacts: any[];
  meetings: any[];
  opportunities: any[];
  events: any[];
};

type ApiFetchOptions = {
  forceNetwork?: boolean;
  requireCache?: boolean;
};

export class OfflineWriteError extends Error {
  constructor() {
    super('CRAM is offline. Changes are read-only until the server reconnects.');
    this.name = 'OfflineWriteError';
  }
}

export class OfflineDataUnavailableError extends Error {
  constructor(path: string) {
    super(`This data was not included in the last offline sync: ${path}`);
    this.name = 'OfflineDataUnavailableError';
  }
}

function readLastSync(): LastSyncRecord | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LAST_SYNC_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastSyncRecord>;
    if (parsed.version !== 1 || typeof parsed.completedAt !== 'string' || !Array.isArray(parsed.paths)) return null;
    if (Number.isNaN(Date.parse(parsed.completedAt))) return null;
    return {
      completedAt: parsed.completedAt,
      paths: parsed.paths.filter((path): path is string => typeof path === 'string'),
      responseCount: Number(parsed.responseCount) || 0,
      version: 1,
    };
  } catch {
    return null;
  }
}

const initialLastSync = readLastSync();
const initialBrowserOnline = typeof navigator === 'undefined' ? true : navigator.onLine;

const [browserOnline, setBrowserOnline] = createSignal(initialBrowserOnline);
const [serverReachable, setServerReachable] = createSignal<boolean | null>(null);
const [syncPhase, setSyncPhase] = createSignal<SyncPhase>(initialLastSync ? 'ready' : 'idle');
const [lastSyncAt, setLastSyncAt] = createSignal<string | null>(initialLastSync?.completedAt || null);
const [cachedResponseCount, setCachedResponseCount] = createSignal(initialLastSync?.responseCount || 0);
const [syncError, setSyncError] = createSignal<string | null>(null);
const [notice, setNotice] = createSignal<string | null>(null);

export {
  browserOnline,
  cachedResponseCount,
  lastSyncAt,
  notice,
  serverReachable,
  syncError,
  syncPhase,
};

export const isOffline = () => !browserOnline() || serverReachable() === false;
export const hasOfflineCopy = () => Boolean(lastSyncAt());

let noticeTimer: number | undefined;
function showNotice(message: string) {
  setNotice(message);
  if (typeof window === 'undefined') return;
  if (noticeTimer !== undefined) window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => setNotice(null), 5000);
}

function absoluteUrl(input: RequestInfo | URL): string {
  if (input instanceof Request) return input.url;
  const raw = input instanceof URL ? input.toString() : input;
  if (typeof window === 'undefined') return raw;
  return new URL(raw, window.location.origin).toString();
}

function cacheRequest(input: RequestInfo | URL): Request {
  return new Request(absoluteUrl(input), { method: 'GET' });
}

/**
 * Only the user-facing CRM dataset is persisted. Operational surfaces such as
 * Broker secrets, backups, agent sessions, and provisioning state must never
 * leak into the long-lived offline cache through a generic GET.
 */
export function isOfflineCacheableApiPath(input: string | URL): boolean {
  const url = new URL(input.toString(), 'https://cram.invalid');
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

async function putApiCache(request: Request, response: Response, required: boolean) {
  if (typeof caches === 'undefined') {
    if (required) throw new Error('Offline storage is unavailable in this browser.');
    return;
  }
  try {
    const cache = await caches.open(API_CACHE_NAME);
    await cache.put(request, response);
  } catch (error) {
    if (required) throw error;
  }
}

async function getApiCache(request: Request): Promise<Response | undefined> {
  if (typeof caches === 'undefined') return undefined;
  try {
    const cache = await caches.open(API_CACHE_NAME);
    return (await cache.match(request)) || undefined;
  } catch {
    return undefined;
  }
}

async function pruneApiCache(requiredPaths: string[]) {
  if (typeof caches === 'undefined') throw new Error('Offline storage is unavailable in this browser.');
  const cache = await caches.open(API_CACHE_NAME);
  const origin = typeof window === 'undefined' ? 'https://cram.invalid' : window.location.origin;
  const keep = new Set(requiredPaths.map((path) => new URL(path, origin).toString()));
  const keys = await cache.keys();
  await Promise.all(keys
    .filter((request) => !keep.has(request.url))
    .map((request) => cache.delete(request)));
}

async function verifyStoredOfflineCopy(record: LastSyncRecord | null) {
  if (!record) return;
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(API_CACHE_NAME);
      const matches = await Promise.all(record.paths.map((path) => cache.match(cacheRequest(path))));
      if (matches.every(Boolean)) return;
    } catch {
      // Treat an unavailable cache as an invalid offline copy below.
    }
  }
  try { localStorage.removeItem(LAST_SYNC_STORAGE_KEY); } catch { /* storage may be disabled */ }
  setLastSyncAt(null);
  setCachedResponseCount(0);
  setSyncPhase('idle');
}

function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof DOMException && error.name === 'NetworkError');
}

/**
 * Network-first REST transport for the existing API client. Successful CRM
 * GETs are persisted by exact URL and transparently replayed when unreachable.
 * Writes always go to the canonical server and are never queued in this phase.
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: ApiFetchOptions = {},
): Promise<Response> {
  const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const cacheable = method === 'GET' && isOfflineCacheableApiPath(absoluteUrl(input));
  const request = cacheable ? cacheRequest(input) : null;

  if (method !== 'GET' && !browserOnline()) {
    const error = new OfflineWriteError();
    showNotice(error.message);
    throw error;
  }

  if (cacheable && !browserOnline() && !options.forceNetwork) {
    const cached = await getApiCache(request!);
    if (cached) {
      setServerReachable(false);
      return cached;
    }
    throw new OfflineDataUnavailableError(new URL(request!.url).pathname + new URL(request!.url).search);
  }

  try {
    const response = await fetch(input, init);
    const offlineReplay = response.headers.get('X-CRAM-Offline') === 'true';
    if (new URL(absoluteUrl(input)).pathname.startsWith('/api/')) setServerReachable(!offlineReplay);
    if (cacheable && response.status < 500 && !offlineReplay) {
      await putApiCache(request!, response.clone(), Boolean(options.requireCache));
    }
    return response;
  } catch (error) {
    if (new URL(absoluteUrl(input)).pathname.startsWith('/api/') && isNetworkFailure(error)) {
      setServerReachable(false);
    }
    if (cacheable) {
      const cached = await getApiCache(request!);
      if (cached) return cached;
      throw new OfflineDataUnavailableError(new URL(request!.url).pathname + new URL(request!.url).search);
    }
    if (method !== 'GET') showNotice('The server could not be reached. No changes were saved.');
    throw error;
  }
}

async function fetchForSync<T>(path: string): Promise<T> {
  const response = await apiFetch(path, {}, { forceNetwork: true, requireCache: true });
  if (response.headers.get('X-CRAM-Offline') === 'true') throw new Error('The server could not be reached.');
  if (response.status >= 500) throw new Error(`${response.status} ${response.statusText}: ${path}`);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function cachePath(path: string): Promise<void> {
  const response = await apiFetch(path, {}, { forceNetwork: true, requireCache: true });
  if (response.headers.get('X-CRAM-Offline') === 'true') throw new Error('The server could not be reached.');
  if (response.status >= 500) throw new Error(`${response.status} ${response.statusText}: ${path}`);
}

async function cacheJsonPath(path: string, value: unknown): Promise<void> {
  await putApiCache(cacheRequest(path), new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }), true);
}

function unique(paths: string[]): string[] {
  return [...new Set(paths)];
}

/** Exported for a focused unit test: these are the detail responses required
 * to make every core CRM detail route readable without a connection. */
export function buildDetailSyncPaths(snapshot: CollectionSnapshot): string[] {
  const accountPaths = snapshot.accounts.flatMap((account) => [
    `/api/accounts/by-slug/${encodeURIComponent(account.slug)}`,
    `/api/accounts/${account.id}/contacts`,
    `/api/accounts/${account.id}/meetings`,
    `/api/accounts/${account.id}/details`,
    `/api/accounts/${account.id}/vendor-heatmap`,
    `/api/accounts/${account.id}/org-chart`,
    `/api/accounts/${account.id}/news`,
    `/api/notes?account_id=${account.id}&limit=500`,
    `/api/threads?account_id=${account.id}`,
    `/api/threads?account_id=${account.id}&include_closed=true`,
  ]);
  const contactPaths = snapshot.contacts.flatMap((contact) => [
    `/api/contacts/${contact.id}`,
    `/api/notes?contact_id=${contact.id}&limit=500`,
  ]);
  const meetingPaths = snapshot.meetings.map((meeting) => `/api/meetings/${meeting.id}`);
  const opportunityPaths = snapshot.opportunities.flatMap((opportunity) => [
    `/api/opportunities/${opportunity.id}`,
    `/api/notes?opportunity_id=${opportunity.id}&limit=500`,
  ]);
  const eventPaths = snapshot.events.map((event) => `/api/events/${event.id}`);
  return unique([...accountPaths, ...contactPaths, ...meetingPaths, ...opportunityPaths, ...eventPaths]);
}

async function mapWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function fetchOpportunitiesForSync(): Promise<{ opportunities: any[]; paths: string[] }> {
  const pathForOffset = (offset: number) =>
    `/api/opportunities?sort=created_at&order=desc&limit=${OPPORTUNITY_PAGE_SIZE}${offset ? `&offset=${offset}` : ''}`;
  const firstPath = pathForOffset(0);
  const first = await fetchForSync<{ opportunities: any[]; total: number }>(firstPath);
  const paths = [firstPath];
  const opportunities = [...(first.opportunities || [])];

  for (let offset = OPPORTUNITY_PAGE_SIZE; offset < first.total; offset += OPPORTUNITY_PAGE_SIZE) {
    const path = pathForOffset(offset);
    paths.push(path);
    const page = await fetchForSync<{ opportunities: any[] }>(path);
    opportunities.push(...(page.opportunities || []));
  }

  return { opportunities, paths };
}

let activeSync: Promise<void> | null = null;

export function syncNow(): Promise<void> {
  if (activeSync) return activeSync;
  activeSync = (async () => {
    if (!browserOnline()) {
      setSyncPhase(lastSyncAt() ? 'ready' : 'idle');
      showNotice(lastSyncAt() ? 'Offline copy is ready, but it cannot be refreshed without a connection.' : 'Connect once to prepare CRAM for offline use.');
      return;
    }

    setSyncPhase('syncing');
    setSyncError(null);

    try {
      const accountsAllPath = '/api/accounts?sort=name';
      const contactsAllPath = '/api/contacts';
      const meetingsAllPath = '/api/meetings?limit=100000';
      const eventsAllPath = '/api/events?sort=start_date&order=asc&limit=10000';

      const [accountsResult, contacts, meetings, opportunitiesResult, eventsResult] = await Promise.all([
        fetchForSync<{ accounts: any[] }>(accountsAllPath),
        fetchForSync<any[]>(contactsAllPath),
        fetchForSync<any[]>(meetingsAllPath),
        fetchOpportunitiesForSync(),
        fetchForSync<{ events: any[] }>(eventsAllPath),
      ]);

      const collectionPaths = unique([
        '/api/health',
        accountsAllPath,
        '/api/accounts?exclude_status=partner&sort=name',
        '/api/accounts?status=partner&sort=name',
        '/api/accounts?exclude_status=partner&sort=last_contact&limit=10',
        '/api/accounts?status=partner&sort=name&limit=10',
        contactsAllPath,
        '/api/contacts/companies',
        meetingsAllPath,
        '/api/meetings?limit=15',
        ...opportunitiesResult.paths,
        '/api/products?limit=500',
        '/api/product-categories?limit=500',
        '/api/vendors?include_deleted=true',
        '/api/vendor-products?include_deleted=true',
        eventsAllPath,
        '/api/events/facets',
        '/api/events/upcoming/with-contacts?mode=in_person&limit=10000',
        '/api/events/upcoming/with-contacts?mode=virtual&limit=10000',
        '/api/events/upcoming/with-contacts?mode=hybrid&limit=10000',
        '/api/events/upcoming/with-contacts?mode=on_demand&limit=10000',
      ]);

      // The five full collections above are already cached; refresh the page-
      // specific variants and supporting collections in a bounded pool.
      const remainingCollections = collectionPaths.filter((path) => ![
        accountsAllPath,
        contactsAllPath,
        meetingsAllPath,
        ...opportunitiesResult.paths,
        eventsAllPath,
      ].includes(path));
      await mapWithConcurrency(remainingCollections, SYNC_CONCURRENCY, cachePath);

      const snapshot: CollectionSnapshot = {
        accounts: accountsResult.accounts || [],
        contacts: contacts || [],
        meetings: meetings || [],
        opportunities: opportunitiesResult.opportunities,
        events: eventsResult.events || [],
      };
      const detailPaths = buildDetailSyncPaths(snapshot);
      const eventDetailPaths = new Set(snapshot.events.map((event) => `/api/events/${event.id}`));
      await mapWithConcurrency(snapshot.events, SYNC_CONCURRENCY, (event) =>
        cacheJsonPath(`/api/events/${event.id}`, event));
      await mapWithConcurrency(
        detailPaths.filter((path) => !eventDetailPaths.has(path)),
        SYNC_CONCURRENCY,
        cachePath,
      );

      const completedAt = new Date().toISOString();
      const requiredPaths = unique([...collectionPaths, ...detailPaths]);
      await pruneApiCache(requiredPaths);
      const responseCount = requiredPaths.length;
      const record: LastSyncRecord = { completedAt, paths: requiredPaths, responseCount, version: 1 };
      localStorage.setItem(LAST_SYNC_STORAGE_KEY, JSON.stringify(record));
      setLastSyncAt(completedAt);
      setCachedResponseCount(responseCount);
      setServerReachable(true);
      setSyncPhase('ready');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Offline sync failed.';
      setSyncError(message);
      setSyncPhase('error');
      if (isNetworkFailure(error)) setServerReachable(false);
    }
  })().finally(() => {
    activeSync = null;
  });
  return activeSync;
}

export function formatLastSyncTimestamp(value: string | null, compact = false): string {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';
  return new Intl.DateTimeFormat(undefined, compact
    ? { hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
  ).format(date);
}

let initialized = false;
let syncInterval: number | undefined;

export function initializeOfflineSupport() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  const cacheValidation = verifyStoredOfflineCopy(initialLastSync);

  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      setSyncError('The offline app shell could not be installed.');
    });
  }

  const onOnline = () => {
    setBrowserOnline(true);
    void syncNow();
  };
  const onOffline = () => {
    setBrowserOnline(false);
    setServerReachable(false);
  };
  const onVisibility = () => {
    if (document.visibilityState !== 'visible' || !navigator.onLine) return;
    setBrowserOnline(true);
    const last = lastSyncAt() ? Date.parse(lastSyncAt()!) : 0;
    if (!last || Date.now() - last >= FOREGROUND_SYNC_STALE_MS) void syncNow();
  };

  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  document.addEventListener('visibilitychange', onVisibility);
  syncInterval = window.setInterval(() => {
    if (document.visibilityState === 'visible' && navigator.onLine) void syncNow();
  }, AUTO_SYNC_INTERVAL_MS);

  // Let the initial render finish first so the sync indicator is visible while
  // a larger first-time snapshot is being prepared.
  window.setTimeout(() => {
    void cacheValidation.finally(() => syncNow());
  }, 0);
}

export function disposeOfflineSupportForTests() {
  if (syncInterval !== undefined && typeof window !== 'undefined') window.clearInterval(syncInterval);
  syncInterval = undefined;
  initialized = false;
}
