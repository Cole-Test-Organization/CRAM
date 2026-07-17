# Offline Sync

CRAM uses one canonical Postgres database on the server. Each browser or
installed PWA keeps its own read-only offline copy of the core CRM dataset.
There is no second local Postgres instance and no database-to-database merge.

## Current implementation: safe offline reading

When the GUI is open and can reach the server, it performs a network-first
refresh of:

- accounts and account detail tabs;
- contacts and contact notes;
- meetings;
- opportunities and opportunity notes;
- events;
- sales/vendor catalogs; and
- account threads/tasks.

The refresh runs on app launch, when the app returns to the foreground, when
the browser reports that connectivity returned, when the user clicks the sync
indicator, and every five minutes while the app remains visible. iOS does not
guarantee that a closed web app will run in the background, so CRAM never
claims that a device is current unless that device completed a foreground
sync.

Every successful response is stored in the browser Cache API by its exact REST
URL. The service worker stores the compiled SPA shell, so an installed app can
start without a connection. If the server cannot be reached, CRM reads fall
back to the cached response. Operational data such as Broker secrets,
provisioning state, backups, agent sessions, and settings is intentionally not
persisted in the offline cache.

The `Last sync` timestamp is written only after every required collection and
detail response has been cached. A failed or interrupted refresh leaves the
previous timestamp intact. The completed sync records its required URL set,
prunes responses that no longer belong to the current snapshot, and verifies
that every required response still exists when the app starts. The
header/sidebar always reports the last successful device-local sync time.

Disconnected writes are currently blocked rather than queued. The server
database remains authoritative, and an attempted write shows that the app is
read-only and that nothing was saved. This prevents an old phone snapshot from
silently overwriting a newer laptop edit.

## Freshness guarantee

The offline copy is as current as the timestamp shown on that device. For
example, if a phone last synced at 8:00 AM and a laptop changes an account at
2:00 PM, the disconnected phone still shows the 8:00 AM copy. Open the phone
while connected and wait for its sync indicator to finish before relying on it
offline.

## Next phase: offline editing

Offline writes require a separate, versioned protocol rather than replaying
HTTP requests blindly:

1. Add a monotonically increasing server revision and tombstone/change feed for
   syncable records.
2. Include each record's base revision in update and delete operations.
3. Store offline commands in a durable per-device outbox with an idempotency
   key.
4. On reconnect, pull remote changes, submit outbox commands, and reject a
   command whose base revision no longer matches.
5. Auto-merge only independent fields. Present same-field edits, delete/update
   races, and relationship changes as explicit conflicts.
6. Add queued/conflicted counts and a conflict-resolution screen to the mobile
   and desktop UI.

That phase will change service behavior and REST schemas. Per `AGENTS.md`, the
HTTP routes, MCP tools, both MCP service bags, and agent instructions must be
updated together when those versioned mutations are introduced.

## Storage and origin

The cache belongs to the exact HTTPS origin and browser profile. Different
hostnames, even when they resolve to the same server, have separate caches and
last-sync timestamps. Cached CRM data is browser-managed local storage, not an
encrypted vault; clearing site data removes it. A future authentication/logout
flow must clear the CRAM caches when the user changes.
