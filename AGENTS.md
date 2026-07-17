# AGENTS.md

Instructions for Codex when working in this repo. For project overview, architecture, and setup, see [README.md](README.md).

## Rules

### Always use the API for writes

When updating accounts, contacts, meetings, or tasks — **use the API endpoints**, not files. The database is the source of truth.

### Keep HTTP, MCP, in-process MCP client, and agent instructions in sync — MANDATORY

The API is exposed through **four parallel surfaces** that must stay aligned. Any time you add, remove, or modify a route/field/behavior/workflow, check all four:

| # | File | What it is |
|---|---|---|
| 1 | `api/src/routes/<resource>/*.js` | HTTP route (Fastify handler, swagger schema) |
| 2 | `api/src/mcp/tools.js` | MCP tool registration (same operation, action-dispatched) |
| 3 | `api/src/mcp/server.js` | Standalone MCP server process — builds the `services` bag passed to `registerTools` for external (HTTP) MCP clients |
| 4 | `api/src/agent/mcp-client.js` | In-process MCP server/client pair used by the in-app agent loop — builds its **own** `services` bag passed to the same `registerTools`. **Easy to forget — if you add a service here, the in-app agent can't see it.** |
| 5 | `api/src/instructions.js` | Agent-facing workflow doc — served over HTTP at `/api/agent` and delivered to MCP clients automatically in the initialize handshake (`InitializeResult.instructions`) |

Shared business logic lives in `api/src/services/<resource>/*.js` — both the HTTP route and MCP tool should call the service, not reimplement logic.

**Folder layout.** `routes/` and `services/` are grouped by top-level resource and mirror each other (`accounts/`, `contacts/`, `vendors/`, `notes/`, …); a resource folder can hold more than one file (e.g. `routes/accounts/` has `accounts.js` + `account-details.js`). Cross-cutting service helpers (`_domain`, `_slug`, `_json`, `_email`, `_enrich`, `_fuzzy-match`, `_html`, `_llm`) live in `services/_shared/`. Folder location never changes a route's URL — Fastify builds paths from the literal strings in each handler plus the `/api` prefix registered in `index.js`.

**HTTP and MCP must be at full parity.** Every service operation reachable via the HTTP API must also be reachable via the MCP tool (and vice versa). It is not enough that both surfaces share a service — both must actually *expose* every operation the service offers. If you add a new service method, add it to both surfaces in the same change. If you find an existing service method that's only wired up on one surface, treat that as a parity bug and fix it. Symptom: an agent asks the MCP client to do something the HTTP API can already do (e.g., filter accounts by status) and gets told it's not possible.

**Two MCP servers, one `registerTools`.** The external MCP server (`api/src/mcp/server.js`, port 3100, HTTP transport) and the in-process MCP server (`api/src/agent/mcp-client.js`, `InMemoryTransport`) each build their own `services` object and hand it to the same `registerTools` in `api/src/mcp/tools.js`. The in-process one is what the in-app `/api/agent` loop calls. If a new service is added to `server.js` but not `mcp-client.js`, the in-app agent will throw `Cannot read properties of undefined` the moment it tries to use that tool — even though everything looks fine when tested against `localhost:3100`. **Always update both `services` bags in the same change.**

**When you change something, update in this order:**

1. **Service** (`api/src/services/`) — the actual logic
2. **HTTP route** (`api/src/routes/`) — wire it up for REST clients, including swagger schema
3. **MCP tool** (`api/src/mcp/tools.js`) — wire it up for MCP clients (add an `action` enum value or a new tool)
4. **Both `services` bags** — add the new service to *both*:
   - `api/src/mcp/server.js` (external MCP, used by Codex / Codex.ai / Cursor / etc.)
   - `api/src/agent/mcp-client.js` (in-process MCP, used by the in-app `/api/agent` loop)
5. **Instructions** (`api/src/instructions.js`):
   - Add/update an entry in the `REFS` map (`{ http, mcp }` representations) for any new or renamed operation
   - Update the "When to Use" and "Common Workflows" prose so agents know when to reach for it
   - Both `/api/agent` (HTTP) and the MCP initialize handshake will pick up the change automatically — don't duplicate. MCP clients re-read instructions only on a new session, so restart clients after doc changes.

Schemas (request/response shapes, validation) come from the OpenAPI spec (HTTP) or `tools/list` (MCP) — don't duplicate them in `instructions.js`.

**Removing an operation?** Delete its `REFS` entry and any prose that referenced it — leaving a stale key will crash the renderer (`Unknown instruction reference`).

**Exception — deterministic HTTP-only endpoints.** A surface that is *only ever* machine-to-machine and deterministic — never invoked by the in-app agent or an external MCP client — may live as **service + HTTP route only**, and is deliberately excluded from the MCP tool (`api/src/mcp/tools.js`), both `services` bags (`api/src/mcp/server.js`, `api/src/agent/mcp-client.js`), and `api/src/instructions.js` / `REFS`. Keep these out of the four-surface parity check. Current exceptions:

- **`calendar-import`** (`POST /api/calendar-import` → `api/src/services/calendar-import/calendar-import.js` + `api/src/routes/calendar-import/calendar-import.js`) — the daily Google Calendar ingestion a Google Apps Script forwards through a Cloudflare tunnel (the Apps Script exporter source lives in `google-scripts/calendar/`). It's deterministic (no LLM) and consumed by the tunnel, not the agent, so it has **no** `calendar_import` MCP tool, is **not** in either `services` bag, and has **no** `instructions.js` entry. If it ever needs to be agent-callable, wire all four surfaces at that point.

### Keep api/SCHEMA.md in sync with the database — MANDATORY

`api/SCHEMA.md` is an auto-generated reference for the live Postgres schema (tables, columns, FKs, unique/check constraints, indexes, enums, views, RLS policies). It's pulled directly from `pg_catalog` by `dev/scripts/dump-schema.js` — **never edit it by hand**.

**After any change that alters the schema** — a new migration, a column added/renamed, a new index, a new enum value, a new RLS policy — run:

```bash
npm --prefix api run db:schema
```

The script reads `DATABASE_URL` (defaults to `postgres://crm:devpassword@localhost:5432/crm` for host use) and rewrites `api/SCHEMA.md`. Commit the regenerated file in the **same commit** as the migration so the doc never drifts from the DB.

**One-time setup on a fresh clone:** `cd dev && npm install`. The host-runnable scripts in `dev/scripts/` live in their own npm package (`dev/package.json`) so they can resolve `pg` without leaning on `api/node_modules`. If you add a new host script in `dev/scripts/` that needs a third-party dep, add it to `dev/package.json` — not `api/package.json`.

### API routes live under /api

All backend routes are registered under the `/api` prefix in `api/src/index.js`. Add new route files inside the existing `/api` plugin scope — don't repeat the prefix and don't extend the Vite proxy (it forwards the entire `/api` and `/docs` trees). SPA paths like `/accounts/:slug` belong to the GUI alone.

### LinkedIn enrichment

Outreach runs through the **API/MCP outreach surface** (`POST /api/outreach/enrich` or the `outreach` MCP tool). Jobs are async, serially queued, and rate-limited (10s min gap, 50/day). Do not shell out to `node outreach/src/index.js` directly from automations — always go through the API so rate limits and the single LinkedIn session are respected. The CLI remains usable for interactive login (`node outreach/src/index.js login`) to refresh `outreach/cookies.json` when the session expires.

### GUI changes must remain mobile-responsive

The app is fully usable on phones — every action that works on desktop must work on mobile too. When you add or modify any UI in `gui/src/`, verify your change at both desktop and mobile widths (use Chrome devtools at 375px). Specifically:

- **Use the `md:` breakpoint (768px)** for desktop-only behavior. Default styles are mobile-first; wrap desktop layouts in `md:` (e.g., `flex-col md:flex-row`, `grid-cols-1 md:grid-cols-3`, `px-4 md:px-10`).
- **Headers (title + actions)**: stack with `flex flex-col gap-3 md:flex-row md:justify-between md:items-center`.
- **List rows**: add `flex-wrap` so meta (date, account name, email) wraps below the title on narrow screens. Don't let long titles squeeze metadata into 0 width.
- **Reuse the responsive primitives**: `.press-field` (inline-edit input), `.btn-x` (× remove buttons), `.input-vintage`, `.press-sm/md/lg`. They already bump touch targets and font sizes (16px to prevent iOS zoom) below 768px. Don't reinvent them with inline Tailwind.
- **Modals**: `Modal.tsx` goes full-screen (100svh) below 768px automatically — don't fight that. Place form fields inside `<FormRow>` so they wrap to one column on mobile.
- **Never hide functionality on mobile.** A button or field accessible on desktop must remain accessible on mobile, even if it has to move. Don't `md:hidden` an action.
- **Keep the neobrutalism/CRT theme**: 0px radii, 2-4px offset shadows, warm amber/coffee palette, monospace text. The `@media (max-width: 767px)` block in `gui/src/index.css` already scales `.press-card` shadow from 4px → 2px on mobile — preserve that pattern.

### Dev environment

The bundled docker-compose has two profiles:

- `prod` — single image, no source mounts, GUI baked in at build time. Use this on a host that's serving the app.
- `dev` — Vite with HMR, source tree mounted in, GUI on port 80. Use this for local development.

Never run dev and prod profiles together — they both bind ports 3100 and 3200.

### Identify the current environment from .env — MANDATORY

Before running any `docker compose` command that rebuilds or restarts the app, **check `LOG_ENV_LABEL` in `.env`** to identify which environment this host is. `LOG_ENV_LABEL=dev` means this is the dev host — use the dev workflow below. `LOG_ENV_LABEL=prod` means it's a prod host — use the prod workflow. `docker compose ps` only tells you what's running *right now*; `LOG_ENV_LABEL` tells you what this machine **is**, which is what governs the rebuild path.

Do not assume from the running containers alone; e.g. if dev was previously brought down for maintenance, `ps` won't reveal the host's actual role. Always read `.env` first.

### Rebuild after every code change — MANDATORY

**Dev host (`LOG_ENV_LABEL=dev`)** — **always defer to `dev/DEV.md` for the dev startup/rebuild command.** Do not derive your own profile list or invent a shorter form; copy the exact command from DEV.md so the observability stack never gets silently dropped. Today that command is:

```bash
docker compose --profile dev --profile observability --profile local-loki up -d
```

For a *code-only* change (anything under `api/src/`, `gui/src/`, `events/src/`, `outreach/src/`, `todoist/src/`, `api/migrations/`), no rebuild is required — sources are bind-mounted and nodemon/Vite hot-reload. Still verify the container reloaded cleanly. `up -d` (no `--build`) is also the right call for `.env` changes — compose recreates the affected container with the new env.

For a *Dockerfile* or system-deps change, you must rebuild. Append `--build` to the DEV.md command (do not drop any profile):

```bash
docker compose --profile dev --profile observability --profile local-loki up -d --build
```

If DEV.md's command ever diverges from what's pasted here, **DEV.md wins** — update AGENTS.md to match, don't run a stale command.

**Prod host (`LOG_ENV_LABEL=prod`)** — the prod image bakes source in at build time (no source mounts, no HMR), so any edit to `api/`, `gui/`, `events/`, `outreach/`, `todoist/`, or the `Dockerfile` is invisible to the running app until the image is rebuilt:

```bash
docker compose --profile prod up -d --build
```

Skipping the env check is not a judgment call. The cost of `cat .env | grep LOG_ENV_LABEL` is trivial; the cost of running a prod rebuild on a dev host (or vice versa) is hours of phantom debugging.

## Modules

- **Outreach** — `outreach/` → @outreach/AGENTS.md — LinkedIn + web enrichment, exposed via the async `/api/outreach/enrich` endpoint and `outreach` MCP tool
- **Todoist (optional)** — `todoist/` → @todoist/AGENTS.md — task creation, defaults configurable via `TODOIST_DEFAULT_PROJECT` / `TODOIST_DEFAULT_SECTION`. Set `TODOIST_ENABLED=false` in `.env` to skip the integration entirely (no HTTP routes under `/api/todoist/*`, no `todoist_tasks` MCP tool, no Todoist references in the agent instructions). Default is enabled — missing/any-non-"false" value loads the integration normally. Toggled in `scripts/setup.sh` via the "Do you use Todoist?" prompt.
