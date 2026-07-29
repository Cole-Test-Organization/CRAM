# CRAM Desktop

`client/` is a minimal Electron wrapper around the existing SolidJS GUI. It
packages the application shell into the `.app`, proxies `/api` requests to the
configured CRAM server while connected, and keeps the existing website offline
snapshot in a persistent Electron session on the Mac.

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

## Install dependencies and run

From this folder:

```bash
npm install
npm start
```

`npm start` builds the shared GUI into `client/dist/renderer` and opens it in
Electron. On first launch, connect Tailscale and wait for the CRAM header to show
a successful sync time. After that, quit, disconnect, and reopen the app to
verify the local read-only copy.

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

## Build a macOS installer

Run on the target Mac:

```bash
npm run dist:mac
```

Or build one architecture explicitly:

```bash
npm run dist:mac:arm64
npm run dist:mac:x64
```

DMG and ZIP artifacts land in `client/release/`. If an Apple signing identity is
available, electron-builder uses it. Without one, it creates an unsigned local
build; macOS may require **Control-click → Open** the first time. Signing and
notarization should be configured before distributing the application to other
people.

## Local data

Chromium CacheStorage and localStorage (including unsynced floating-note drafts)
live under CRAM Desktop's macOS Application Support folder. The endpoint-keyed
meeting schedule is stored there as a private JSON file. This storage is
persistent but is not an encrypted vault. The application menu has
**File → Open Local Data Folder** so the exact location can be inspected.

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
