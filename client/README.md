# CRAM Desktop

`client/` is a minimal Electron wrapper around the existing SolidJS GUI. It
packages the application shell into the `.app`, proxies `/api` requests to the
configured CRAM server while connected, and keeps the existing website offline
snapshot in a private, endpoint-specific native cache on the Mac.

The desktop client intentionally has the same offline boundary as the website:

- Core CRM reads are local after a successful sync: accounts, contacts,
  meetings, opportunities, events, catalogs, notes, and account threads/tasks.
- Broker/provisioning state, secrets, backups, agent sessions, and settings are
  never written to the long-lived offline cache.
- Core CRM writes are not queued while offline. The floating meeting editor is
  the narrow exception: it keeps a device-local draft on every keystroke so
  notes cannot be lost during a DNS/proxy outage. An unsynced draft stays
  visibly local until you explicitly save it to CRAM; automatic conflict
  reconciliation remains future work.

The UI itself is always local, so launching the client does not depend on
Tailscale DNS or the HTTP proxy. Only a refresh from the canonical server needs
network access.

## macOS requirements

- macOS 12 Monterey or newer
- Node.js 22.12+ and npm to build from source
- An Apple Silicon (`arm64`) or Intel (`x64`) Mac to create the corresponding
  DMG

## Development run

From this folder:

```bash
npm install
npm start
```

`npm start` is a development command. It builds the shared GUI into
`client/dist/renderer` and opens Electron as a child of that terminal, so
closing the terminal also stops the development process. Use the packaged
installation below for the normal terminal-independent app.

On first launch, connect Tailscale and wait for the CRAM header to show a
successful sync time. After that, quit, disconnect, and reopen the app to verify
the local read-only copy.

## Server configuration

The default endpoint is:

```text
https://crm.home.justcole.com
```

On first launch, the client writes:

```text
~/Library/Application Support/CRAM Desktop/config.json
```

with this shape:

```json
{
  "serverUrl": "https://crm.home.justcole.com",
  "autoOpenMeetingNotes": true,
  "launchAtLogin": true
}
```

Quit the application before editing that file. You can reveal it from
**File → Show Configuration File**. For development or one-off testing, command
line and environment overrides take precedence:

```bash
CRAM_SERVER_URL=http://localhost:3200 npm start
npm start -- --server-url=https://crm.example.com
```

Remote endpoints must use HTTPS; plain HTTP is accepted only for `localhost`,
`127.0.0.1`, or `::1` development servers.

Each normalized server URL gets a separate persistent Electron partition, so a
cached dataset from one CRAM server is never replayed for another server.

API requests made by the desktop proxy have a 15-second ceiling. If DNS, TLS,
the private route, or the server stalls beyond that point, the request fails
deterministically so the shared GUI can replay its offline copy or show a
connection error instead of displaying `Loading...` indefinitely.

`autoOpenMeetingNotes` controls the meeting-start scheduler. `launchAtLogin`
registers a packaged macOS build as a login item so the scheduler can be
running before the first meeting; it has no effect during `npm start`
development runs. Both default to `true`, including for older configuration
files where the keys are absent. Set either to `false` and restart CRAM Desktop
to opt out.

## Floating meeting notes

Open any meeting in CRAM Desktop and click **Float Notes**. The compact notes
window:

- stays above normal application windows;
- follows you across macOS Spaces and remains available over full-screen apps;
- edits the existing CRAM meeting rather than creating a second notes record;
- autosaves to CRAM while connected; and
- stores every edit immediately as a local draft before the network save.

The window cannot appear above protected macOS system surfaces such as the lock
screen or security prompts. Closing it does not quit the scheduler.

When `autoOpenMeetingNotes` is enabled, the client refreshes meeting times from
CRAM every five minutes and sets a local timer for the next `starts_at`. It also
keeps an endpoint-specific schedule snapshot under the application data folder,
so a meeting already synchronized to the Mac can still open while Tailscale DNS
or the HTTP proxy is unavailable. If the Mac wakes during a meeting, the active
meeting opens as soon as the client resumes.

Automatic opening requires a precise `starts_at` value. Meetings created by the
Google Calendar import already have one; an untimed meeting cannot be scheduled.
The application must be running, which is why packaged builds enable
`launchAtLogin` by default. Manually quitting CRAM Desktop stops the scheduler
until the application is launched again.

An offline/local draft is intentionally not uploaded silently on a later
launch. Reopen the floating editor and click **Save to CRAM** once connected.
The status beneath the editor always distinguishes local-only from server-saved
notes.

## Diagnostic log

CRAM Desktop writes private, rotating JSONL diagnostics to:

```text
~/Library/Logs/CRAM Desktop/client.log
```

The previous bounded file is `client.log.previous`. Use **File → Show
Diagnostic Log** to reveal the active file in Finder.

The log records app/config startup, packaged-renderer presence, local window
navigation, preload and renderer failures, renderer warning/error messages,
unresponsive or crashed renderers, meeting-scheduler failures, and failed,
slow, or non-success API proxy requests. Request bodies and headers are never
logged; sensitive fields and URL query values are redacted. The active file is
created with user-only permissions.

If the local shell itself fails, the window is now shown with an error dialog
and a direct path to this log instead of remaining hidden behind
`ready-to-show`.

## Build, install, and locally update on macOS

For this Mac, one command creates an ad-hoc-signed DMG/ZIP, installs or replaces
the app under `~/Applications`, keeps the previous build as a rollback copy, and
launches the packaged app:

```bash
npm run release:local
```

The installed `CRAM Desktop.app` is independent of Terminal. Packaged builds
also register as a per-user login item when `launchAtLogin` is enabled, so the
meeting scheduler can keep running after login. macOS may ask you to approve
the login item and Local Network access the first time; Local Network access is
required to refresh from a private LAN or Tailscale address, but the existing
offline copy remains readable when that network is unavailable.

If Local Network access was previously denied, open **System Settings → Privacy
& Security → Local Network** and enable **CRAM Desktop**, then click the sync
status in CRAM to retry. The same pane is available inside the app at **File →
Open Local Network Privacy Settings**.

Run the same command after pulling/building newer source to update the
installation. The app must be quit during replacement. Application data is
stored separately under `~/Library/Application Support/CRAM Desktop`, so
replacing the `.app` does not remove the offline snapshot, configuration, or
meeting drafts. The immediately previous app bundle is retained at:

```text
~/Library/Application Support/CRAM Desktop/Updates/Previous CRAM Desktop.bundle-backup
```

Artifacts land in `client/release/`, including
`CRAM Desktop-<version>-<arch>.dmg`. The DMG can also be opened and dragged into
`/Applications` manually; dragging a newer version over the old app is the
manual update path.

For a Developer ID release instead of this Mac-only local build, run:


```bash
npm run dist:mac
```

Or build one architecture explicitly:

```bash
npm run dist:mac:arm64
npm run dist:mac:x64
```

If a **Developer ID Application** signing identity is installed in the login
keychain, electron-builder uses it. Apple Developer membership by itself does
not install that certificate. Notarization credentials are also required before
distributing the app to other people. `release:local` deliberately uses ad-hoc
signing and does not require either credential.

## Local data

The offline API snapshot uses an endpoint-specific native file cache, matching
the storage boundary used by the Swift mobile client. Chromium localStorage
(including unsynced floating-note drafts) and the endpoint-keyed meeting
schedule live under the same macOS Application Support folder. This storage is
persistent but is not an encrypted vault. The application menu has **File →
Open Local Data Folder** so the exact location can be inspected.

## Validation

```bash
npm test
npm run check
npm run build
```

`npm run pack` additionally creates an unpacked application for the current
host platform. A signed/notarized DMG must be validated on macOS.

The desktop, web, and Swift mobile clients intentionally share one future
backend synchronization boundary. See
[`../docs/client-sync-architecture.md`](../docs/client-sync-architecture.md);
the backend delta/mutation protocol described there is not implemented yet.
