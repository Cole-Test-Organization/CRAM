# CRAM

**Customer Relationship Agentic Manager** — a self-hosted CRM with a built-in agent loop. A REST API, a SolidJS web UI, and an MCP server, all in front of Postgres, designed to be driven as much by an LLM as by a human.

What's included:

- **Accounts, contacts, meetings, opportunities, events** — the standard CRM shape, with per-user row-level security in Postgres.
- **Two ways to call it** — REST under `/api` (with OpenAPI/Swagger docs at `/docs`) and the same operations exposed as MCP tools at `/mcp`. The same business logic backs both.
- **In-process agent loop** — a streaming `POST /api/agent/query` endpoint that runs entirely on a local LLM (Ollama by default, or any OpenAI-compatible server: LM Studio / llama.cpp / vLLM) — no cloud API keys, running on this device or a machine on your LAN.
- **Outreach enrichment** — a queued LinkedIn + web research pipeline for filling in contact details.
- **Events scraper** — pluggable per-source. The included `paloaltonetworks` source pulls the public PAN event calendar and joins it against your contacts.

## Installation

CRAM runs in Docker. The recommended deployment is on a mini-PC or always-on machine on your home/office LAN — that way it's reachable from your phone, laptop, and any MCP client at the same address. It also runs fine on a single laptop if you just want it locally.

### Prerequisites

- **Docker** (with Docker Compose). Install Docker for your OS first — instructions are at [docker.com](https://www.docker.com/get-started/).
- **A local LLM** — the agent runs on [Ollama](https://ollama.com) (or any OpenAI-compatible server: LM Studio / llama.cpp / vLLM), by default on the device hosting the app. Pull a model (e.g. `ollama pull gemma4:e4b`) and you're set — no cloud API keys. You can also point it at an LLM on another machine on your LAN from the GUI.

### Option A — Ubuntu mini-PC (recommended)

This is the LAN-hosted setup. Best for "always available" access across all your devices.

```bash
git clone <this repo> cram
cd cram
./scripts/setup.sh                          # interactively writes .env
docker compose --profile prod up -d --build
```

CRAM listens on **this machine only** by default. Since this is the LAN-hosted setup, answer **Y** to "Expose CRAM to your LAN?" when `scripts/setup.sh` asks (or set `BIND_ADDRESS=0.0.0.0` in `.env` and restart). It's then reachable at:

- **GUI/API**: `http://<mini-pc-ip>:3200` from any device on the LAN, or `http://localhost:3200` from the mini-PC itself.
- **MCP server**: `http://<mini-pc-ip>:3100/mcp` from the LAN, or `http://localhost:3100/mcp` from the mini-PC itself.

Find the mini-PC's IP with `ip addr` or in your router's admin page. Consider giving it a DHCP reservation so the address doesn't change.

**Don't expose the box to the public internet as-is** — there's no auth layer yet. Use a VPN (Tailscale, WireGuard) if you need to reach it from outside your LAN.

To update later, run the bundled restart script from the repo root:

```bash
./scripts/restart-prod.sh
```

It tears down the running containers, runs `git pull`, and brings the stack back up with `--build`. The `db` container and `postgres_data` volume are untouched on rebuild; pending schema migrations run automatically on startup.

If you'd rather do it by hand:

```bash
git pull
docker compose --profile prod up -d --build
```

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
| `SELF_DOMAINS` | Comma-separated company email domains; contacts/attendees from them are flagged "internal" (skipped for account creation + outreach). `setup.sh` seeds it from your email — a bootstrap default until you curate the list in Settings. |
| `LOCAL_BASE_URL` | The agent runs on a **local LLM** — by default Ollama on the device hosting the app. Point this at a LAN machine to use a server elsewhere. No API keys required. The *model* is chosen per-user in the GUI (**Settings → Agent LLM**) or auto-selected from what your Ollama has installed — there is no model env var. |
| `POSTGRES_*` | DB credentials for the bundled compose stack |
| `BIND_ADDRESS` | Host interface the app's ports (3200, 3100) bind to. `127.0.0.1` = this machine only (**default**); set `0.0.0.0` to expose CRAM on your LAN. Postgres always stays local. |
| `TODOIST_ENABLED` | Set `false` to skip the Todoist integration entirely |

The agent runs entirely on a local LLM (Ollama on the device by default). Choose the model and where it runs — this device or another machine on your LAN — per-user in the GUI (**Settings → Agent LLM**); the env vars above are the server-wide default.

## Optional module setup

The core CRM works out of the box after `docker compose up`. These modules need a one-time setup step if you want to use them.

### LinkedIn enrichment & persona research (outreach)

The outreach module powers **persona research** — building a background picture (role, career history, public activity) of the people you sell to, alongside company and industry enrichment. It works by driving *your own* authenticated LinkedIn session, so you log in once on a machine with a desktop browser to capture session cookies. Persona research stays disabled until those cookies exist.

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

The container picks it up automatically (it's bind-mounted). Re-run the login when the session expires (typically a few weeks). Once the cookies are in place, persona research runs from the app's outreach feature (the GUI Agent page or the `outreach` MCP tool) — no further setup.

### Todoist

Action items from meeting notes can be pushed straight into Todoist. Enable during `scripts/setup.sh` (it'll ask "Do you use Todoist?") — you'll be prompted for your API token from [todoist.com/app/settings/integrations/developer](https://todoist.com/app/settings/integrations/developer) and it'll be written to `todoist/.env`.

Skip the prompt (or set `TODOIST_ENABLED=false` in `.env`) to disable the integration entirely.

### Events scraper

The events module pulls in-person events from configured sources. The bundled source scrapes the public Palo Alto Networks event calendar — no setup required, it just works.

Run a scrape on demand with `node events/src/index.js scrape` (add `--api-url <url>` to point it at a non-default API). Wire it to an external scheduler (host cron, systemd timer) if you want it to run recurring.

To add new sources, drop a scraper file into `events/src/scrapers/` and register it.

### Calendar import (daily auto-import)

Your daily meetings can flow into the CRM automatically. A Google Apps Script reads a day's calendar events and POSTs them to `POST /api/calendar-import`, which creates a meeting per event and resolves attendees/accounts by email domain. The exporter source and setup steps live in [`calendar/`](calendar/README.md). It's optional — the CRM works fine without it; you can also create meetings by hand or via the API/MCP.

## Usage

Once running:

- **Web UI**: `http://<host>:3200`
- **API docs (Swagger UI)**: `http://<host>:3200/docs`
- **MCP endpoint** — point Claude Desktop, Cursor, or any other MCP client at `http://<host>:3100/mcp`. The server delivers its full workflow doc and tool schemas on connect.

## License

See [LICENSE](LICENSE).
