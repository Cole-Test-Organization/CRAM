import { createSignal } from 'solid-js';

const STORAGE_KEY = 'cram.write-queue.v1';
const MAX_ENTRIES = 200;
const MAX_BODY_BYTES = 256 * 1024;

export type QueuedWrite = {
  id: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
  enqueuedAt: string;
};

export type RejectedWrite = QueuedWrite & {
  status: number;
  detail: string;
};

/**
 * Thrown instead of returning a synthetic success. A queued write has no server
 * response — no id, no slug, no updated_at — so handing callers a fake one
 * would let them act on values the server never produced. The meeting-notes
 * editor is the sharp edge: it clears the local draft and reports "Saved to
 * CRAM" on a resolved save, which would discard notes that only sit in a queue.
 */
export class WriteQueuedError extends Error {
  readonly queuedId: string;

  constructor(queuedId: string) {
    super('Saved to the offline queue. It will sync when you switch back online.');
    this.name = 'WriteQueuedError';
    this.queuedId = queuedId;
  }
}

/**
 * A queued write is accepted, not failed. Optimistic UI must keep its update
 * rather than roll it back — the change is going to land, and reverting leaves
 * the screen contradicting the queue.
 */
export function isWriteQueued(error: unknown): boolean {
  return error instanceof WriteQueuedError;
}

export class WriteQueueFullError extends Error {
  constructor() {
    super(`The offline queue is full (${MAX_ENTRIES} changes). Go back online to sync before editing more.`);
    this.name = 'WriteQueueFullError';
  }
}

function storage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function isQueuedWrite(value: unknown): value is QueuedWrite {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<QueuedWrite>;
  return typeof entry.id === 'string'
    && typeof entry.method === 'string'
    && typeof entry.url === 'string'
    && typeof entry.enqueuedAt === 'string'
    && (entry.body === null || typeof entry.body === 'string')
    && Boolean(entry.headers)
    && typeof entry.headers === 'object'
    && !Array.isArray(entry.headers);
}

function read(): QueuedWrite[] {
  const store = storage();
  if (!store) return [];
  try {
    const parsed = JSON.parse(store.getItem(STORAGE_KEY) || 'null');
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.writes)) return [];
    return parsed.writes.filter(isQueuedWrite);
  } catch {
    return [];
  }
}

const [queuedWrites, setQueuedWrites] = createSignal<QueuedWrite[]>(read());
const [rejectedWrites, setRejectedWrites] = createSignal<RejectedWrite[]>([]);
const [replaying, setReplaying] = createSignal(false);

export { queuedWrites, rejectedWrites, replaying };

export const queuedWriteCount = () => queuedWrites().length;

function persist(entries: QueuedWrite[]) {
  setQueuedWrites(entries);
  const store = storage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify({ version: 1, writes: entries }));
  } catch {
    // A full storage quota must not take down the editor the user is typing in.
  }
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `w${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export function enqueueWrite(input: {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}): QueuedWrite {
  const entries = queuedWrites();
  if (entries.length >= MAX_ENTRIES) throw new WriteQueueFullError();
  if (input.body !== null && new Blob([input.body]).size > MAX_BODY_BYTES) {
    throw new Error('This change is too large to queue offline. Go back online to save it.');
  }

  const entry: QueuedWrite = {
    id: newId(),
    method: input.method,
    url: input.url,
    headers: input.headers,
    body: input.body,
    enqueuedAt: new Date().toISOString(),
  };
  persist([...entries, entry]);
  return entry;
}

export function clearWriteQueue() {
  persist([]);
}

export function dismissRejectedWrites() {
  setRejectedWrites([]);
}

export type ReplayOutcome = {
  replayed: number;
  rejected: number;
  remaining: number;
  error: string | null;
};

/**
 * Replays in FIFO order and stops at the first transport or server failure, so
 * two edits to the same record can never land out of order. A 4xx is different:
 * the server understood and refused it, and retrying forever would wedge every
 * change behind it — those are dropped into `rejectedWrites` for the user to see.
 */
export async function replayWriteQueue(
  doFetch: typeof fetch = fetch,
): Promise<ReplayOutcome> {
  if (replaying()) return { replayed: 0, rejected: 0, remaining: queuedWrites().length, error: null };
  setReplaying(true);
  let replayed = 0;
  const rejected: RejectedWrite[] = [];
  let error: string | null = null;

  try {
    let pending = queuedWrites();
    while (pending.length) {
      const [next, ...rest] = pending;
      let response: Response;
      try {
        response = await doFetch(next.url, {
          method: next.method,
          headers: next.headers,
          ...(next.body === null ? {} : { body: next.body }),
        });
      } catch (cause) {
        error = cause instanceof Error ? cause.message : 'The server could not be reached.';
        break;
      }

      // A drainer holding the user's only copy of a change must not throw on a
      // malformed reply — stop and keep the entry rather than lose it.
      if (!response || typeof response.status !== 'number') {
        error = 'The server returned an unreadable response.';
        break;
      }
      if (response.status >= 500 || response.status === 408 || response.status === 429) {
        error = `${response.status} ${response.statusText || 'Server error'} — will retry.`;
        break;
      }
      if (response.status >= 400) {
        rejected.push({
          ...next,
          status: response.status,
          detail: (await response.text().catch(() => '')).slice(0, 300),
        });
      } else {
        replayed += 1;
      }
      pending = rest;
      persist(pending);
    }
  } finally {
    setReplaying(false);
  }

  if (rejected.length) setRejectedWrites([...rejectedWrites(), ...rejected]);
  return { replayed, rejected: rejected.length, remaining: queuedWrites().length, error };
}

/** Test-only: queue state is module-level and shared across cases. */
export function resetWriteQueueForTests() {
  setRejectedWrites([]);
  setReplaying(false);
  persist([]);
}
