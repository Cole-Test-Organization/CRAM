# Cross-client synchronization boundary

This document records the intended seam for synchronization across the CRAM web
app, Electron desktop client, and Swift mobile client. It is an architecture
constraint, not an implemented backend sync protocol.

## What exists today

All three clients render the same `gui/` application and therefore use the same
offline snapshot planner in `gui/src/lib/offline.ts`.

| Client | App shell | Durable API snapshot | Writes while offline |
|---|---|---|---|
| Web/PWA | Service worker | Browser CacheStorage | Queued in `localStorage`, replayed on return to Online |
| Electron | Bundled renderer | Endpoint-specific native response files | Queued in `localStorage`, replayed on return to Online |
| Swift mobile | Bundled renderer | Endpoint-specific native response cache through the mobile bridge | Queued in `localStorage`, replayed on return to Online |

The current planner downloads complete core collections plus the detail URLs
needed by every core detail route. Cache keys are exact request URLs. Secret or
operational surfaces are excluded.

### Offline is a mode, not an inference

`gui/src/lib/offline.ts` never guesses whether the network is usable. The
operator selects `online` or `offline` (persisted under
`cram.connection-mode.v1`) and the transport obeys it:

- **Online** — every request is attempted. A cached response is substituted
  only *after* a real failure, and is announced rather than swapped in
  silently. A failed request marks `serverUnreachable()` for display only; it
  never changes the mode.
- **Offline** — nothing touches the network. Reads resolve from the snapshot or
  raise `OfflineDataUnavailableError`; writes are queued.

This replaced inference from `navigator.onLine` and from request outcomes. Both
were unreliable in practice — `navigator.onLine` reports only that an interface
exists, not that the CRAM server is reachable, and a single transient
`ERR_NETWORK_CHANGED` used to strand the whole app in read-only until something
happened to flip it back.

### Write queue

`gui/src/lib/writeQueue.ts` parks offline writes verbatim (method, URL,
headers, body) and replays them FIFO when the operator returns to Online.

- A queued write **rejects** with `WriteQueuedError` rather than resolving with
  a synthetic response. Callers must not receive server-assigned values the
  server never produced — the meeting-notes editor clears its local draft and
  reports "Saved to CRAM" on a resolved save, so a fake success would discard
  notes that exist only in the queue.
- Replay stops at the first transport or 5xx failure, so two edits to one
  record cannot land out of order. A 4xx is dropped into `rejectedWrites`
  instead of retried forever, which would wedge every later change behind it.
- This is still last-write-wins against server state. It is a convenience for a
  single operator on one device, **not** a conflict-resolution protocol — see
  below for what a real one requires.

The Swift implementation separates:

- `APITransporting` — how a request reaches the canonical server;
- `ResponseCaching` — how an exact response is durably stored;
- `OfflineCachePolicy` — the security boundary for what may persist; and
- the narrow JavaScript bridge — how the shared snapshot planner accesses
  platform storage.

Electron and the PWA already have equivalent transport/storage boundaries in
`gui/src/lib/offline.ts` and their platform shell. Electron uses a narrow
preload/IPC bridge because Chromium CacheStorage cannot persist request keys
from the custom `cram://` application origin. The shared renderer means a future
protocol client can land once in TypeScript for web/Electron, with a small
conforming Swift transport on iOS.

## Future backend protocol

When CRAM needs offline writes or efficient incremental refresh, the backend
should own one deterministic HTTP-only sync contract. Do not teach each client
to infer changes by comparing today's resource-specific REST responses.

A future design should provide:

1. **Transactional bootstrap.** One snapshot version and cursor representing a
   consistent server view.
2. **Cursor-based deltas.** Ordered upserts and tombstones after that cursor,
   with pagination and an explicit cursor-expired/full-resync response.
3. **Stable entity revisions.** Server-issued revisions or versions on every
   synchronized record, independent of wall-clock precision.
4. **Idempotent mutations.** A client-generated mutation ID, entity ID, base
   revision, operation, and payload; retries must be safe.
5. **Explicit conflicts.** The server returns current state plus structured
   conflict metadata. Clients must not silently use last-writer-wins for meeting
   notes or CRM relationships.
6. **Capability/version negotiation.** A protocol version and advertised entity
   set let old clients continue safely through backend evolution.
7. **Per-user authorization and deletion semantics.** Deltas, snapshots, and
   tombstones must obey the same user boundary as normal API reads.

An illustrative envelope—not a committed schema—is:

```json
{
  "protocolVersion": 1,
  "snapshotVersion": "opaque-server-version",
  "cursor": "opaque-next-cursor",
  "hasMore": false,
  "changes": [
    {
      "entity": "meeting",
      "id": "42",
      "revision": "opaque-entity-revision",
      "operation": "upsert",
      "data": {}
    }
  ]
}
```

Mutation submission should use a separate batch envelope with
`clientMutationId` and `baseRevision`; this keeps downloads read-only and makes
retry/conflict behavior testable.

## Migration path

1. Add and integration-test the deterministic backend sync service and HTTP
   routes. Under the repository rules it can remain HTTP-only because it is a
   machine client protocol, not an agent operation.
2. Add a TypeScript sync adapter behind the existing offline API transport.
   Keep the current full snapshot as a fallback during rollout.
3. Add a Swift adapter conforming to `APITransporting`/`ResponseCaching`.
4. Validate bootstrap and delta parity using the same fixtures across browser,
   Electron, and Swift tests.
5. Only then replace the last-write-wins write queue with a durable mutation
   outbox carrying `clientMutationId`/`baseRevision`, plus entity-specific
   conflict policies. Meeting-note drafts stay in their own local draft store
   (`gui/src/lib/meetingDraft.ts`) until that policy exists — they are
   keystroke-frequency and must not enter the write queue.

## Guardrails

- The backend database remains the canonical source of truth.
- A sync cache is not a backup and is not an encrypted vault.
- Endpoint and user identity must be part of every local store namespace.
- Schema migration and cache migration must be versioned independently.
- Cache admission remains allowlisted; generic GET caching must never include
  secrets, provisioning state, backups, or agent sessions.
- The shipped write queue is a **single-operator, single-device convenience**
  and deliberately stops short of a sync protocol. It has no idempotency keys,
  no tombstones, and no conflict UX: a replayed write overwrites whatever the
  server holds. That is acceptable only while one person edits CRAM from one
  device at a time.
- Do not extend that queue to multiple devices, shared editing, or background
  replay without first adding idempotency, tombstones, and a tested conflict
  UX. The failure mode is silent data loss, not a visible error.
