# GUI

SolidJS single-page app with Tailwind CSS. Consumes the API and renders the CRM.

## Stack

- **SolidJS** — reactive UI framework
- **Vite** — dev server + bundler
- **Tailwind CSS** — styling
- **TypeScript** — type checking

## Setup

```bash
cd gui
npm install
```

## Running

### Dev server (hot module reload)

```bash
npm run dev
```

Vite runs on port 80 and proxies the `/api` and `/docs` prefixes to `http://localhost:3200`. Proxy config lives in [`vite.config.ts`](vite.config.ts).

All backend routes live under `/api` (set in `api/src/index.js`), so SPA paths like `/accounts/:slug` no longer collide with the `/api/accounts/:id` route — new API routes don't need to be added to the proxy individually.

### Production build

```bash
npm run build
```

Outputs static files to `../api/public/`, which Fastify serves at `/` with SPA fallback on unknown paths.

## Pages

| Route | File | Purpose |
|---|---|---|
| `/` | Dashboard | Search, stats, recent meetings, account lists |
| `/accounts` | Accounts | All non-partner accounts (anything where `status` is not `partner`) |
| `/partners` | Partners | Accounts filtered by `status=partner` |
| `/accounts/:slug` | Account detail | Full account view with contacts and meetings |
| `/meetings` | Meeting list | Global meeting list with search |
| `/meetings/:id` | Meeting detail | Single meeting with markdown body |
| `/internal` | Internal list | Internal meeting notes |
| `/internal/:id` | Internal detail | Single internal note |
| `/contacts` | Contact directory | Global contact search with company filter |
| `/contacts/:id` | Contact detail | Single contact with linked accounts |

## Docker

In dev mode (`docker compose --profile dev`) the container runs Vite on port 80 alongside the API on 3200. The `gui/src/`, `gui/index.html`, and `gui/vite.config.ts` paths are volume-mounted so changes trigger HMR.

In production mode the GUI is pre-built into `api/public/` by the Dockerfile's `gui-build` stage and served statically by Fastify.
