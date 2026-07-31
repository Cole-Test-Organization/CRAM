# Cross-client synchronization boundary

This document records the intended seam for synchronization across the CRAM web
app, Electron desktop client, and Swift mobile client. It is an architecture
constraint, not an implemented backend sync protocol.

## What exists today

All three clients render the same `gui/` application and therefore use the same
offline snapshot planner in `gui/src/lib/offline.ts`.

| Client | App shell | Durable API snapshot | Writes while offline |
|---|---|---|---|
| Web/PWA | Service worker | Browser CacheStorage | Rejected |
| Electron | Bundled renderer | Endpoint-specific native response files | Rejected |
| Swift mobile | Bundled renderer | Endpoint-specific native response cache through the mobile bridge | Rejected |

The current planner downloads complete core collections plus the detail URLs
needed by every core detail route. Cache keys are exact request URLs. Secret or
operational surfaces are excluded. This is intentionally conservative:
server state is authoritative, clients do not generate competing offline
revisions, and no conflict algorithm is needed yet.

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
5. Only then introduce a durable mutation outbox and entity-specific conflict
   policies. Meeting-note drafts remain local-only until that policy exists.

## Guardrails

- The backend database remains the canonical source of truth.
- A sync cache is not a backup and is not an encrypted vault.
- Endpoint and user identity must be part of every local store namespace.
- Schema migration and cache migration must be versioned independently.
- Cache admission remains allowlisted; generic GET caching must never include
  secrets, provisioning state, backups, or agent sessions.
- Do not ship offline mutation replay without idempotency, tombstones, and a
  tested conflict UX.
