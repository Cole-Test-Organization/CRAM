# Outreach Research

**See [README.md](README.md) for full documentation.**

## How to call it

Outreach is exposed through the API/MCP as an async queued service. Prefer this over shelling out — the queue enforces a single LinkedIn session and respects the 10s min-gap / 50-per-day rate limit globally.

- HTTP: `POST /api/outreach/enrich` → returns a `jobId`; poll `GET /api/outreach/enrich/:jobId` until `status` is `completed` or `failed`.
- MCP: `outreach` tool, action `enqueue` to start, `get_job` to poll, `stats` for queue/rate-limit state.
- CLI (interactive only): `node outreach/src/index.js login` to refresh `outreach/cookies.json` when the session expires. Do not use the CLI research commands from automations — go through the API.

## Auth

The LinkedIn session lives in `outreach/cookies.json`. If that file is missing or the session is stale, enqueued jobs will fail with a session error. Run `node outreach/src/index.js login` on the host interactively to refresh.

## Usage Examples

```bash
# Research a person (deep mode includes full profile)
node outreach/src/index.js person "Jane Doe" --linkedin --company "Cisco" --deep

# Research a company
node outreach/src/index.js company "Palo Alto Networks" --linkedin --deep

# Research an industry
node outreach/src/index.js industry "healthcare cybersecurity" --linkedin --limit 20

# Check session status
node outreach/src/index.js status
```

The CLI is useful for local debugging and for the interactive `login` command; the API/MCP surface is the production path.

## When to Use LinkedIn (Outreach CLI) vs. Web Search

**LinkedIn research (`node outreach/src/index.js`) is expensive** — it consumes LinkedIn session quota and risks rate limiting. Only use it for people and companies where the LinkedIn data is actually valuable.

**Use LinkedIn research for:**

- **Customer contacts** — the people you're selling to. Their LinkedIn profiles give you background, career history, and talking points.

**Do NOT use LinkedIn research for:**

- **Partner / channel companies** (e.g., Trace3, Keller Schroeder, CDW) — just use `WebFetch` on their website to get a basic overview. You already know what partners do; you don't need deep LinkedIn intel on them.
- **Partner / channel contacts** — use `WebFetch` or basic web lookups. Don't burn LinkedIn sessions on people who are on your side of the deal.
- **Company overviews** — use `WebFetch` on the company's website instead of `node outreach/src/index.js company`. The CLI company search rarely returns useful LinkedIn results anyway. Save LinkedIn for person lookups on customer contacts.
