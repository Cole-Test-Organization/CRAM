# Google Apps Scripts

Scripts that run *in* Google Apps Script (pasted into the editor — `clasp` is
blocked by admin policy). They deploy outside this repo but are tracked here so
they version alongside the CRM they talk to. Each is self-contained — paste
into its own Apps Script project.

| Module | What it does |
|---|---|
| [`calendar/`](calendar/README.md) | Exports a day's Google Calendar meetings and POSTs them to `/api/calendar-import` (behind Cloudflare Access). |
| [`news/`](news/README.md) | Bookmarkable web app: fetches + keyword-ranks Google News for a company. Standalone port of `api/src/services/news`. |
