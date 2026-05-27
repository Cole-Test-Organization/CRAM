# CRAM

**Customer Relationship Agentic Manager** — a self-hosted CRM with a built-in agent loop. A REST API, a SolidJS web UI, and an MCP server, all in front of Postgres, designed to be driven as much by an LLM as by a human.

What's included:

- **Accounts, contacts, meetings, opportunities, events** — the standard CRM shape, with per-user row-level security in Postgres.
- **Two ways to call it** — REST under `/api` (with OpenAPI/Swagger docs at `/docs`) and the same operations exposed as MCP tools at `/mcp`. The same business logic backs both.
- **In-process agent loop** — a streaming `POST /api/agent/query` endpoint that runs against your configured LLM provider (Anthropic by default, or any local LLM via Ollama / LM Studio / llama.cpp / vLLM).
- **Outreach enrichment** — a queued LinkedIn + web research pipeline for filling in contact details.
- **Events scraper** — pluggable per-source. The included `paloaltonetworks` source pulls the public PAN event calendar and joins it against your contacts.

## Installation

CRAM runs in Docker. The recommended deployment is on a mini-PC or always-on machine on your home/office LAN — that way it's reachable from your phone, laptop, and any MCP client at the same address. It also runs fine on a single laptop if you just want it locally.

### Prerequisites

- **Docker** (with Docker Compose). Install Docker for your OS first — instructions are at [docker.com](https://www.docker.com/get-started/).
- **(Optional) Anthropic API key** — needed if you want the agent loop to use Claude. You can skip this and configure a local LLM from the GUI instead.

### Option A — Ubuntu mini-PC (recommended)

This is the LAN-hosted setup. Best for "always available" access across all your devices.

```bash
git clone <this repo> cram
cd cram
./scripts/setup.sh                          # interactively writes .env
docker compose --profile prod up -d --build
```

CRAM is now reachable on your LAN at:

- **GUI/API**: `http://<mini-pc-ip>:3200`
- **MCP server**: `http://<mini-pc-ip>:3100/mcp`

Find the mini-PC's IP with `ip addr` or in your router's admin page. Consider giving it a DHCP reservation so the address doesn't change.

**Don't expose the box to the public internet as-is** — there's no auth layer yet. Use a VPN (Tailscale, WireGuard) if you need to reach it from outside your LAN.

To update later:

```bash
git pull
docker compose --profile prod up -d --build
```

The `db` container and `postgres_data` volume are untouched on rebuild; pending schema migrations run automatically on startup.

### Option B — macOS laptop

1. Install [Docker Desktop for Mac](https://www.docker.com/products/docker-desktop/) and launch it once so the engine starts.
2. In a terminal:

   ```bash
   git clone <this repo> cram
   cd cram
   ./scripts/setup.sh
   docker compose --profile prod up -d --build
   ```

3. Open `http://localhost:3200`.

### Option C — Windows laptop

1. Install [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/). It will prompt you to enable WSL 2 — accept that.
2. Launch Docker Desktop once and let it finish starting.
3. Open a WSL terminal (recommended) or PowerShell:

   ```bash
   git clone <this repo> cram
   cd cram
   bash scripts/setup.sh
   docker compose --profile prod up -d --build
   ```

4. Open `http://localhost:3200`.

## Configuration

`scripts/setup.sh` writes a `.env` for you. You can also copy `.env.example → .env` and edit by hand. The values that matter most:

| Variable | What it does |
|---|---|
| `VENDOR_NAME`, `USER_ROLE` | Shape the agent's system prompt — e.g. "CRM assistant for a $VENDOR $ROLE" |
| `ANTHROPIC_API_KEY` | Required for the agent loop unless you use a local LLM |
| `POSTGRES_*` | DB credentials for the bundled compose stack |
| `TODOIST_ENABLED` | Set `false` to skip the Todoist integration entirely |

Provider and model are picked per-request in the GUI's Agent page (persisted in localStorage) — no env vars needed for those.

## Optional module setup

The core CRM works out of the box after `docker compose up`. These modules need a one-time setup step if you want to use them.

### LinkedIn enrichment (outreach)

The outreach module enriches contact records using your authenticated LinkedIn session. You need to log in once to capture session cookies.

**On a machine with a desktop browser** (your laptop):

```bash
cd outreach
npm install
node src/index.js login
```

This opens a browser window — log in to LinkedIn manually. A `outreach/cookies.json` file is written when you're done. (Node.js 20+ required for this step.)

**If CRAM is on a headless mini-PC**, run the login on your laptop as above, then copy the resulting `outreach/cookies.json` to the same path on the mini-PC:

```bash
scp outreach/cookies.json user@mini-pc:/path/to/cram/outreach/cookies.json
```

The container picks it up automatically (it's bind-mounted). Re-run the login when the session expires (typically a few weeks).

### Todoist

Action items from meeting notes can be pushed straight into Todoist. Enable during `scripts/setup.sh` (it'll ask "Do you use Todoist?") — you'll be prompted for your API token from [todoist.com/app/settings/integrations/developer](https://todoist.com/app/settings/integrations/developer) and it'll be written to `todoist/.env`.

Skip the prompt (or set `TODOIST_ENABLED=false` in `.env`) to disable the integration entirely.

### Events scraper

The events module runs on a schedule and pulls in-person events from configured sources. The bundled source scrapes the public Palo Alto Networks event calendar — no setup required, it just works.

In `.env`:

- `EVENTS_SCRAPE_CRON` — schedule (standard 5-field cron, default `0 6 * * *` = daily at 06:00 local).
- `DISABLE_SCHEDULER=1` — turn the scheduled scrape off entirely.

To add new sources, drop a scraper file into `events/src/scrapers/` and register it.

## Usage

Once running:

- **Web UI**: `http://<host>:3200`
- **API docs (Swagger UI)**: `http://<host>:3200/docs`
- **MCP endpoint** — point Claude Desktop, Cursor, or any other MCP client at `http://<host>:3100/mcp`. The server delivers its full workflow doc and tool schemas on connect.

## License

See [LICENSE](LICENSE).
