import { createSignal } from 'solid-js';
import {
  isCramMobile,
  mobileCacheBridge,
} from './mobile';
import {
  desktopCacheBridge,
  isCramDesktop,
} from './desktop';
import type {
  CachedApiResponse,
  ClientCacheBridge,
} from './clientCache';
import {
  enqueueWrite,
  queuedWriteCount,
  replayWriteQueue,
  WriteQueuedError,
} from './writeQueue';

const API_CACHE_NAME = 'cram-api-v1';
const LAST_SYNC_STORAGE_KEY = 'cram.offline-sync.v1';
const CONNECTION_MODE_STORAGE_KEY = 'cram.connection-mode.v1';
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

export const hasOfflineCopy = () => Boolean(lastSyncAt());

/**
 * Offline is a mode the operator chooses, never a state the app infers.
 *
 * Inference could not be made trustworthy here: `navigator.onLine` reports only
 * that some network interface exists — not that the CRAM server is reachable —
 * and it is wrong constantly on a machine running a VPN. Deriving the mode from
 * request outcomes was worse: one transient `ERR_NETWORK_CHANGED` dropped the
 * whole app into read-only until something happened to flip it back. So the
 * mode is explicit, and a failed request now means only that one request failed.
 */
export type ConnectionMode = 'online' | 'offline';

function readConnectionMode(): ConnectionMode {
  if (typeof localStorage === 'undefined') return 'online';
  try {
    return localStorage.getItem(CONNECTION_MODE_STORAGE_KEY) === 'offline' ? 'offline' : 'online';
  } catch {
    return 'online';
  }
}

const [connectionMode, setConnectionModeSignal] = createSignal<ConnectionMode>(readConnectionMode());

export { connectionMode };

export const isOfflineMode = () => connectionMode() === 'offline';
/** The last request failed. Informational only — it never gates anything. */
export const serverUnreachable = () => serverReachable() === false;
export const isOffline = isOfflineMode;

export async function setConnectionMode(mode: ConnectionMode): Promise<void> {
  if (mode === connectionMode()) return;
  setConnectionModeSignal(mode);
  try { localStorage.setItem(CONNECTION_MODE_STORAGE_KEY, mode); } catch { /* storage may be disabled */ }

  if (mode === 'offline') {
    setServerReachable(null);
    showNotice(hasOfflineCopy()
      ? 'Offline mode. Reads come from the last synced copy and edits are queued.'
      : 'Offline mode, but this device has no synced copy yet.');
    return;
  }

  await flushQueuedWrites();
  void syncNow();
}

/**
 * Drains the offline queue against the live server. Called when the operator
 * returns to Online mode, and nudged by the browser `online` event.
 */
export async function flushQueuedWrites(): Promise<void> {
  if (isOfflineMode() || !queuedWriteCount()) return;
  const outcome = await replayWriteQueue();
  const synced = outcome.replayed
    ? `${outcome.replayed} queued change${outcome.replayed === 1 ? '' : 's'} synced.`
    : '';
  if (outcome.error) {
    showNotice(`${synced} ${outcome.remaining} still queued — ${outcome.error}`.trim());
  } else if (outcome.rejected) {
    showNotice(`${synced} ${outcome.rejected} rejected by the server.`.trim());
  } else if (outcome.replayed) {
    showNotice(synced);
  }
}

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

function nativeCacheBridge(): ClientCacheBridge | null {
  return mobileCacheBridge() || desktopCacheBridge();
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
  const nativeCache = nativeCacheBridge();
  if (nativeCache) {
    try {
      const bodyBase64 = arrayBufferToBase64(await response.arrayBuffer());
      await nativeCache.put(request.url, {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        bodyBase64,
      });
    } catch (error) {
      if (required) throw error;
    }
    return;
  }
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
  const nativeCache = nativeCacheBridge();
  if (nativeCache) {
    try {
      const cached = await nativeCache.get(request.url);
      return cached ? responseFromNativeCache(cached) : undefined;
    } catch {
      return undefined;
    }
  }
  if (typeof caches === 'undefined') return undefined;
  try {
    const cache = await caches.open(API_CACHE_NAME);
    return (await cache.match(request)) || undefined;
  } catch {
    return undefined;
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function responseFromNativeCache(cached: CachedApiResponse): Response {
  const binary = atob(cached.bodyBase64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new Response(bytes.buffer, {
    status: cached.status,
    statusText: cached.statusText,
    headers: cached.headers,
  });
}

function markOfflineReplay(response: Response): Response {
  if (response.headers.get('X-CRAM-Offline') === 'true') return response;
  const headers = new Headers(response.headers);
  headers.set('X-CRAM-Offline', 'true');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function pruneApiCache(requiredPaths: string[]) {
  const origin = typeof window === 'undefined' ? 'https://cram.invalid' : window.location.origin;
  const keep = new Set(requiredPaths.map((path) => new URL(path, origin).toString()));
  const nativeCache = nativeCacheBridge();
  if (nativeCache) {
    if (nativeCache.prune) {
      await nativeCache.prune([...keep]);
      return;
    }
    const keys = await nativeCache.keys();
    await Promise.all(keys
      .filter((key) => !keep.has(key))
      .map((key) => nativeCache.delete(key)));
    return;
  }
  if (typeof caches === 'undefined') throw new Error('Offline storage is unavailable in this browser.');
  const cache = await caches.open(API_CACHE_NAME);
  const keys = await cache.keys();
  await Promise.all(keys
    .filter((request) => !keep.has(request.url))
    .map((request) => cache.delete(request)));
}

export async function hasCompleteOfflineCopy(paths: string[]): Promise<boolean> {
  const nativeCache = nativeCacheBridge();
  if (nativeCache) {
    const storedKeys = new Set(await nativeCache.keys());
    return paths.every((path) => storedKeys.has(cacheRequest(path).url));
  }
  if (typeof caches === 'undefined') return false;
  const cache = await caches.open(API_CACHE_NAME);
  const matches = await Promise.all(paths.map((path) => cache.match(cacheRequest(path))));
  return matches.every(Boolean);
}

async function verifyStoredOfflineCopy(record: LastSyncRecord | null) {
  if (!record) return;
  try {
    if (await hasCompleteOfflineCopy(record.paths)) return;
  } catch {
    // Treat an unavailable or incomplete cache as an invalid offline copy.
  }
  try { localStorage.removeItem(LAST_SYNC_STORAGE_KEY); } catch { /* storage may be disabled */ }
  setLastSyncAt(null);
  setCachedResponseCount(0);
  setSyncPhase('idle');
}

function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof DOMException && error.name === 'NetworkError');
}

function pathAndQuery(url: string): string {
  const parsed = new URL(url);
  return parsed.pathname + parsed.search;
}

/** In Offline mode a write is parked verbatim rather than attempted. */
function queueOfflineWrite(input: RequestInfo | URL, init: RequestInit, method: string): never {
  const body = init.body === undefined || init.body === null ? null : init.body;
  if (body !== null && typeof body !== 'string') {
    throw new Error('This change cannot be queued offline. Switch to Online mode to save it.');
  }
  const entry = enqueueWrite({
    method,
    url: absoluteUrl(input),
    headers: Object.fromEntries(new Headers(init.headers).entries()),
    body,
  });
  const pending = queuedWriteCount();
  showNotice(`Change queued — ${pending} pending. Switch to Online to sync.`);
  throw new WriteQueuedError(entry.id);
}

/**
 * Network-first REST transport for the existing API client.
 *
 * In Online mode every request is attempted, always — the transport never
 * decides in advance that the network is not worth trying, which is what used
 * to strand the app in a false offline state. A cached copy is substituted only
 * after a real failure, and says so. In Offline mode nothing touches the
 * network: reads come from the snapshot and writes go to the queue.
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: ApiFetchOptions = {},
): Promise<Response> {
  const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const cacheable = method === 'GET' && isOfflineCacheableApiPath(absoluteUrl(input));
  const request = cacheable ? cacheRequest(input) : null;

  if (isOfflineMode()) {
    if (method !== 'GET') queueOfflineWrite(input, init, method);
    const cached = cacheable ? await getApiCache(request!) : undefined;
    if (cached) return markOfflineReplay(cached);
    throw new OfflineDataUnavailableError(pathAndQuery(absoluteUrl(input)));
  }

  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (error) {
    if (new URL(absoluteUrl(input)).pathname.startsWith('/api/') && isNetworkFailure(error)) {
      setServerReachable(false);
    }
    if (cacheable) {
      const cached = await getApiCache(request!);
      if (cached) {
        // Falling back to the snapshot is the point of offline support, but it
        // must never look like a fresh read. A silent replay right after a
        // write reads as "my change did not save" when the server in fact
        // took it and only the confirming GET lost the network.
        if (!options.requireCache) {
          showNotice('The server could not be reached. Showing the last synced copy.');
        }
        return markOfflineReplay(cached);
      }
      throw new OfflineDataUnavailableError(new URL(request!.url).pathname + new URL(request!.url).search);
    }
    if (method !== 'GET') showNotice('The server could not be reached. No changes were saved.');
    throw error;
  }

  const offlineReplay = response.headers.get('X-CRAM-Offline') === 'true';
  if (new URL(absoluteUrl(input)).pathname.startsWith('/api/')) setServerReachable(!offlineReplay);
  if (cacheable && response.status < 500 && !offlineReplay) {
    await putApiCache(request!, response.clone(), Boolean(options.requireCache));
  }
  return response;
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
    if (isOfflineMode()) {
      setSyncPhase(lastSyncAt() ? 'ready' : 'idle');
      showNotice(lastSyncAt()
        ? 'Offline mode. Switch to Online to refresh the local copy.'
        : 'Offline mode. Switch to Online once to prepare CRAM for offline use.');
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

  if (!isCramMobile() && !isCramDesktop() && 'serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      setSyncError('The offline app shell could not be installed.');
    });
  }

  // These events are hints for when it is worth retrying — never gates. The
  // mode alone decides whether the network gets touched.
  const onOnline = () => {
    setBrowserOnline(true);
    if (isOfflineMode()) return;
    void flushQueuedWrites().then(() => syncNow());
  };
  const onOffline = () => setBrowserOnline(false);
  const onVisibility = () => {
    if (document.visibilityState !== 'visible' || isOfflineMode()) return;
    const last = lastSyncAt() ? Date.parse(lastSyncAt()!) : 0;
    if (!last || Date.now() - last >= FOREGROUND_SYNC_STALE_MS) void syncNow();
  };

  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  document.addEventListener('visibilitychange', onVisibility);
  syncInterval = window.setInterval(() => {
    if (document.visibilityState === 'visible' && !isOfflineMode()) void syncNow();
  }, AUTO_SYNC_INTERVAL_MS);

  // Let the initial render finish first so the sync indicator is visible while
  // a larger first-time snapshot is being prepared.
  window.setTimeout(() => {
    void cacheValidation
      .finally(() => flushQueuedWrites())
      .finally(() => syncNow());
  }, 0);
}

/** Test-only: connection mode is module state shared across cases. */
export function resetConnectionModeForTests() {
  setConnectionModeSignal('online');
  try { localStorage.removeItem(CONNECTION_MODE_STORAGE_KEY); } catch { /* storage may be disabled */ }
}

/** Test-only: the notice banner is module state shared across cases. */
export function resetNoticeForTests() {
  if (noticeTimer !== undefined && typeof window !== 'undefined') window.clearTimeout(noticeTimer);
  noticeTimer = undefined;
  setNotice(null);
}

export function disposeOfflineSupportForTests() {
  if (syncInterval !== undefined && typeof window !== 'undefined') window.clearInterval(syncInterval);
  syncInterval = undefined;
  initialized = false;
}
