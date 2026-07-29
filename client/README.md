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
- Offline mode is read-only. Writes are not queued and cannot overwrite newer
  server data. Sync conflict handling and reconciliation are future work.

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
  "serverUrl": "https://crm.home.justcole.com"
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

Chromium CacheStorage and localStorage live under CRAM Desktop's macOS
Application Support folder. This storage is persistent but is not an encrypted
vault. The application menu has **File → Open Local Data Folder** so the exact
location can be inspected.

## Validation

```bash
npm test
npm run check
npm run build
```

`npm run pack` additionally creates an unpacked application for the current
host platform. A signed/notarized DMG must be validated on macOS.
