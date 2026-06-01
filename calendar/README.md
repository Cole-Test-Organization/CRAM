# Calendar export (Google Apps Script)

The **client side** of the daily calendar ingestion. A Google Apps Script reads
a day's events from Google Calendar and POSTs them as JSON to the CRM, which
turns each event into a meeting (resolving attendees/accounts by email domain).

This is the source of truth for the script. It runs *in* Google Apps Script
(pasted into the editor — `clasp` is blocked by admin policy), so it isn't built
or deployed by this repo; it's tracked here so the exporter and the endpoint it
feeds live together.

## How it connects

```
Google Calendar
   └─ Apps Script: postMeetingsToEndpoint()   ← this module
        └─ POST https://calendar.justcole.com  (Cloudflare Access)
             └─ Cloudflare tunnel → origin
                  └─ POST /api/calendar-import  ← api/src/routes/calendar-import.js
                       └─ CalendarImportService  ← api/src/services/calendar-import.js
```

The endpoint is **deterministic / machine-to-machine** (no LLM, not agent- or
MCP-callable) — see the `calendar-import` exception in [CLAUDE.md](../CLAUDE.md).

## Files

| File | What it is |
|------|------------|
| `post-meetings-to-endpoint.gs` | The Apps Script. Self-contained — paste into its own Apps Script project. |
| `sample-payload.json` | Example of the JSON body it POSTs (the shape `/api/calendar-import` consumes). |
| `.env.example` | Template for the Cloudflare service-token values. Copy to `.env` (gitignored). |

## Setup

1. **Cloudflare service token.** Zero Trust → Access → Service Auth → create a
   Service Token. Add a policy with the **Service Auth** action that includes the
   token to the Access application in front of the endpoint.
2. **Script Properties (NOT the file).** In the Apps Script editor: Project
   Settings (gear) → Script Properties, add two properties — paste only the token
   values:
   - `CF_ACCESS_CLIENT_ID` — the Client ID (looks like `xxxxxxxx.access`)
   - `CF_ACCESS_CLIENT_SECRET` — the Client Secret (shown only once in Cloudflare)
3. **CONFIG consts** at the top of the `.gs` — `ENDPOINT_URL`, `TARGET_DATE`,
   `CALENDAR_ID`, `ONLY_WITH_GUESTS`.
4. Select `postMeetingsToEndpoint` and **Run**. The first run prompts for Calendar
   and external-request permissions — approve both. Check the Execution log for the
   HTTP status + response body.

> **Secrets never live in the `.gs`.** The committed `.gs` ships with placeholder
> credential values; the real token is read at runtime from Script Properties via
> `getRequiredProp_(...)`. Don't paste live Client ID/Secret values into the file —
> they'd land in git history (this repo is distributable).
>
> To keep the values on disk anyway, store them in **`calendar/.env`** (gitignored,
> copied from `.env.example`). Nothing here reads it at runtime — it's just a local
> store so the credentials live next to the script; paste the same values into the
> Apps Script Script Properties.

## Daily automation

To run every day, add a **time-driven trigger** in the Apps Script editor
(Triggers → Add Trigger → `postMeetingsToEndpoint`, *Time-driven* → *Day timer*),
and have the script target "today" instead of a hard-coded `TARGET_DATE`. The
import is **idempotent** — meetings are keyed on the calendar event id, so
re-sending a day is a no-op.

## Notes on the endpoint contract

- The script authenticates with **CF-Access headers only**. The endpoint also
  supports an optional defense-in-depth `x-calendar-import-token` header (set
  `CALENDAR_IMPORT_TOKEN` on the API to require it) — this script doesn't send it,
  so leave that env var unset, or extend the `headers` block to include it.
- The script doesn't send `self`/`owner`, so the API relies on `CALENDAR_SELF_EMAIL`
  to exclude the calendar owner from contact creation. Set that on the API side.
- All-day events and organizer-only holds are skipped by the importer unless
  `CALENDAR_IMPORT_ALL_DAY` / `CALENDAR_IMPORT_SOLO` are enabled on the API.

See `api/src/routes/calendar-import.js` (swagger schema) and
`api/src/services/calendar-import.js` for the full classification rules.
