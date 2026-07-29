# CRAM Mobile

`mobile/` is the SwiftUI iPhone/iPad client for CRAM. Like the Electron
client, it packages the existing SolidJS interface inside a local application
shell. The interface therefore launches without DNS, proxy, or CRAM server
access and stays visually and behaviorally aligned with the web and desktop
clients.

The native layer is intentionally narrow:

- `WKURLSchemeHandler` serves the bundled renderer and proxies `/api` to the
  configured CRAM server.
- Core CRM GET responses are stored in an endpoint-specific, file-protected
  native cache and replayed after a network/DNS failure.
- The existing `gui/src/lib/offline.ts` sync plan remains the source of truth
  for which collection and detail URLs form a complete offline snapshot.
- Writes always target the server and are never queued while offline.
- Meeting notes use the same every-keystroke local draft as Electron. iOS
  presents the editor as a focused sheet; iOS cannot float it above other apps.

Operational data such as provisioning state, Broker secrets, backups, agent
sessions, and settings is never admitted to the durable offline cache.

## Requirements

- macOS with Xcode 16 or newer
- iOS 17 or newer (device or simulator)
- Node.js 22.12+ and npm

iOS 17 is the minimum because the app uses an identified persistent
`WKWebsiteDataStore` per CRAM endpoint. That keeps localStorage, drafts, cookies,
and other WebKit data from one server out of every other server's profile.

## Build and run

From the repository root:

```bash
npm --prefix gui ci
open mobile/CRAMMobile.xcodeproj
```

In Xcode:

1. Select the `CRAMMobile` scheme and an iPhone/iPad simulator or device.
2. For a physical device, choose your signing team under the app target's
   **Signing & Capabilities** tab.
3. Run the app.

The Xcode target runs `mobile/scripts/build-web.sh` before compilation. That
script builds the shared GUI into `CRAMMobile/Resources/Web`; generated web
assets are ignored by Git.

A command-line simulator build is:

```bash
xcodebuild \
  -project mobile/CRAMMobile.xcodeproj \
  -scheme CRAMMobile \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/cram-mobile-derived-data \
  CODE_SIGNING_ALLOWED=NO \
  build-for-testing
```

## Server configuration

The default endpoint matches Electron:

```text
https://crm.home.justcole.com
```

Open the web UI's **Settings → Mobile app** card to change it. Remote servers
must use HTTPS. Plain HTTP is accepted only for `localhost`, `127.0.0.1`, and
`::1` simulator development.

Changing endpoints creates/selects a different native response cache and a
different persistent WebKit data store. It does not delete either endpoint's
data.

## Offline behavior

Open the app while connected and wait for the shared sync indicator to report a
successful sync. The visible app refreshes on launch, foreground, reconnect,
manual request, and the shared five-minute interval. iOS may suspend the app in
the background, so the displayed last-sync timestamp remains the authority for
snapshot freshness.

Once synchronized:

- accounts, contacts, meetings, opportunities, events, catalogs, notes, and
  account threads/tasks remain readable;
- the app shell always launches locally;
- ordinary writes fail visibly instead of entering a hidden queue; and
- focused meeting notes keep a local draft until an explicit server save
  succeeds.

Automatic meeting-start windows from Electron are not copied literally: iOS
does not allow an app to bring itself to the foreground or float over other
apps. A future notification scheduler can deep-link into the focused notes
sheet without changing the data layer.

## Validation

On macOS:

```bash
xcodebuild \
  -project mobile/CRAMMobile.xcodeproj \
  -scheme CRAMMobile \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  CODE_SIGNING_ALLOWED=NO \
  test
```

The Swift test target covers endpoint validation/isolation, the cache boundary,
durable response storage, pruning, and offline replay. The root hermetic suite
also runs dependency-free structural and cross-client contract checks:

```bash
npm run test:mobile
```

The future backend synchronization boundary is documented in
[`../docs/client-sync-architecture.md`](../docs/client-sync-architecture.md).
No backend delta feed, mutation queue, or conflict resolver is implemented in
this change.
