# API

Fastify REST API backed by Postgres with per-user row-level security. Serves the built SolidJS GUI as static files and exposes an MCP server for LLM agents.

## Stack

- **Fastify 5** — HTTP server
- **Postgres 16** — data store with `tsvector`/`GIN` full-text search and `FORCE ROW LEVEL SECURITY`
- **node-pg-migrate** — schema migrations (files in `migrations/`)
- **@modelcontextprotocol/sdk** — MCP server at `/mcp` on port 3100

## Setup

```bash
cd api
npm install
```

A running Postgres is required. The easiest path is `docker compose --profile dev up -d` from the repo root (starts the bundled `db` container).

## Running

```bash
# Main API (Fastify) — port 3200
npm start

# Same thing with file-watch auto-restart
npm run dev

# MCP server (separate process) — port 3100
npm run mcp
```

When running outside Docker, set `DATABASE_URL=postgres://crm:devpassword@localhost:5432/crm` so the API reaches the published port of the `db` container.

## Database

### Schema migrations

Migrations live in `migrations/` and run via `node-pg-migrate`. They're written in CommonJS (`.cjs`) because the package is ESM but the migration runner uses `require()`.

```bash
npm run db:migrate              # apply all pending migrations
npm run db:migrate:down         # roll back the latest
npm run db:migrate:create name  # scaffold a new migration
```

The dev Docker entrypoint runs `db:migrate` automatically on startup, so you rarely call these by hand.

### Multi-tenancy & RLS

Every domain row carries a `user_id` FK. `ALTER TABLE ... FORCE ROW LEVEL SECURITY` is enabled on every domain and junction table. Every request sets the current user's ID on the session before running any query:

```sql
SELECT set_config('app.current_user_id', '<id>', true);
```

Policies restrict `SELECT`/`INSERT`/`UPDATE`/`DELETE` to rows where `user_id = current_setting('app.current_user_id')::bigint`. If the session variable isn't set, queries return zero rows and inserts fail the `WITH CHECK` clause — the app is fail-closed by default.

This is orchestrated in `src/db/connection.js` via the `withUser(userId, fn)` helper: it borrows a client from the pool, starts a transaction, sets the session var, runs the callback, and commits (or rolls back on error). Every service method takes `userId` as its first argument and wraps its queries in `withUser`.

Until real auth lands, `src/auth.js` returns a cached default-user ID for every request (looked up by `DEFAULT_USER_EMAIL`).

### Full-text search

Each searchable table has a `search_vector tsvector GENERATED ALWAYS AS (...) STORED` column with a GIN index. Queries use `to_tsquery` with prefix matching (e.g., `prisma` matches `prisma-access`) and `ts_rank` for ordering. Snippets are generated with `ts_headline` against the most relevant text column.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgres://crm:devpassword@db:5432/crm` | Postgres connection string |
| `DATABASE_SSL` | `false` | Set `true` for Azure DB / managed Postgres |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | `true` | Set `false` for self-signed certs |
| `DEFAULT_USER_EMAIL` | `default@local` | User that migrated rows are attached to |
| `DEFAULT_USER_NAME` | `Default User` | Display name for the seed user |
| `PORT` | `3200` | API listen port |
| `HOST` | `0.0.0.0` | API bind address |
| `MCP_PORT` | `3100` | MCP server listen port |
| `MCP_HOST` | `0.0.0.0` | MCP server bind address |

## Endpoints

All API routes are mounted under the `/api` prefix (e.g. `/api/accounts`, `/api/contacts/:id`). The endpoint paths in the tables below are written without the prefix for brevity — prepend `/api` to any of them.

Full interactive docs: `http://localhost:3200/docs` (Swagger UI). LLM-friendly markdown reference: `http://localhost:3200/api/agent`.

### Accounts
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/accounts` | List accounts (filters: `?status=`, `?sort=`, `?limit=`, `?offset=`) |
| `GET` | `/accounts/search?q=` | Fuzzy search accounts by name |
| `GET` | `/accounts/by-slug/:slug` | Full account with contacts + meetings |
| `GET` | `/accounts/:id` | Full account by ID |
| `POST` | `/accounts` | Create account |
| `PATCH` | `/accounts/:id` | Partial update (smart merge, see below) |
| `PUT` | `/accounts/:id` | Full replace |
| `DELETE` | `/accounts/:id` | Delete account |

### Contacts
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/contacts` | List contacts (filters: `?company=`, `?search=`) |
| `GET` | `/contacts/companies` | Distinct companies with contact counts |
| `GET` | `/contacts/:id` | Single contact with linked accounts |
| `GET` | `/accounts/:accountId/contacts` | Contacts for an account |
| `POST` | `/accounts/:accountId/contacts` | Create contact linked to account |
| `POST` | `/contacts` | Create standalone contact |
| `POST` | `/contacts/:id/accounts/:accountId` | Link existing contact to account |
| `DELETE` | `/contacts/:id/accounts/:accountId` | Unlink contact from account |
| `PATCH` | `/contacts/:id` | Partial update |
| `DELETE` | `/contacts/:id` | Delete contact |

### Meetings
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/meetings` | List all meetings (pagination: `?limit=`, `?offset=`) |
| `GET` | `/accounts/:accountId/meetings` | Meetings for an account |
| `GET` | `/meetings/:id` | Single meeting with full body + attendees |
| `POST` | `/accounts/:accountId/meetings` | Create meeting (requires `contact_ids` array) |
| `PUT` | `/meetings/:id` | Update meeting |
| `DELETE` | `/meetings/:id` | Delete meeting |

### Internal Notes
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/internal` | List internal notes |
| `GET` | `/internal/:id` | Single internal note |
| `POST` | `/internal` | Create internal note |
| `PUT` | `/internal/:id` | Update internal note |
| `DELETE` | `/internal/:id` | Delete internal note |

### Search
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/search?q=&type=&limit=` | Full-text search (type: `all`, `accounts`, `contacts`, `meetings`, `internal`) |

### Todoist
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/todoist/tasks` | Create task |
| `POST` | `/todoist/tasks/batch` | Batch create |
| `GET` | `/todoist/tasks` | List tasks (filters: `?label=`, `?filter=`) |
| `POST` | `/todoist/tasks/:id/close` | Close task |

### System
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | DB record counts (scoped to current user) and uptime |
| `GET` | `/docs` | Swagger UI |
| `GET` | `/agent` | Markdown API reference for LLM agents |
| `GET` | `/export/accounts/:slug` | Export an account as a Drive-ready ZIP of Word documents |
| `POST` | `/export/accounts` | Export selected account slugs as one Drive-ready ZIP, with one folder per account |
| `GET` | `/export/all` | Export everything as a ZIP of Word documents |

## PATCH merge strategy

`PATCH /accounts/:id` uses field-specific merging:
- **Scalars** (`status`, `last_contact`, `relationship_summary`): replaced
- **`environment`**: shallow merge (`{...existing, ...patch}`)
- **`channel_partners` / `pa_team`**: merge by name (updates existing entries, appends new ones)

## Data model

```
users ── owns ──┐
                ├── accounts ──┐
                │              ├── account_contacts ── contacts
                │              │
                │              └── meetings
                │                    └── meeting_attendees ── contacts
                │
                ├── contacts
                │
                ├── meetings
                │
                └── internal_notes
```

- **Users** — tenant rows. Every other table carries a `user_id` FK.
- **Accounts** — relationship metadata, environment info, deal notes. `UNIQUE(user_id, slug)`.
- **Contacts** — standalone records linked to accounts via a junction table. A contact can belong to multiple accounts.
- **Meetings** — belong to one account; linked to contacts via `meeting_attendees`.
- **Internal notes** — freestanding meeting records not tied to any account. `UNIQUE(user_id, filename)`.

JSON fields (`channel_partners`, `pa_team`, `environment`) are stored as `JSONB`.

## MCP

The MCP server (`src/mcp/server.js`) is a separate process that exposes the API as tools for LLM agents. It listens on `:3100` at `/mcp` and is started automatically by both the dev entrypoint and the prod entrypoint, so `docker compose --profile dev` or `--profile prod` gives you a working MCP endpoint with no extra setup. If you're running outside Docker, start it with `npm run mcp`. Until per-session auth lands, every MCP tool call operates as the default user.

Tools: `accounts`, `contacts`, `meetings`, `internal_notes`, `search`, `todoist_tasks`, `export_markdown`. Each tool dispatches on an `action` arg (`list`/`get`/`create`/`update`/`delete`).

`export_markdown` accepts exactly one scope: `slug` for one account, `slugs` for a selected multi-account bundle, or `all=true` for every account plus internal notes. The matching HTTP export routes return the same source content as Drive-ready Word-document ZIPs.

## Testing

```bash
npm test
```

Hits `http://localhost:3200/api` with `fetch` — the API must be running.

## Project layout

```
api/
├── src/
│   ├── index.js            # Fastify app, route registration, static GUI serving
│   ├── config.js           # Env var parsing
│   ├── auth.js             # getCurrentUserId (stubbed to default user)
│   ├── db/connection.js    # pg.Pool + withUser helper
│   ├── services/           # one class per domain (accounts, contacts, …)
│   ├── routes/             # one file per endpoint group
│   └── mcp/                # MCP server + tool definitions
├── migrations/             # node-pg-migrate .cjs files
├── scripts/                # dump-schema.js, seed-dev-data.js
├── public/                 # Built GUI (generated by `cd gui && npm run build`)
└── test/                   # HTTP endpoint tests
```
