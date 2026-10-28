# Krisp webhook → email

The **receiving side** of Krisp meeting-output delivery. [Krisp](https://krisp.ai)
fires a webhook when a meeting's **notes** (key points / action items),
**transcript**, or **outline** is generated and POSTs JSON to the API, which
**emails you the notes** through Gmail. Nothing is written to the CRM.

There is no client code to host here — Krisp is the sender; this is the endpoint
contract + setup notes. The endpoint is **deterministic / machine-to-machine**
(no LLM, not agent- or MCP-callable) — see the `krisp-webhook` exception in
[CLAUDE.md](../CLAUDE.md).

## What it does

`POST /api/krisp-webhook` (`api/src/routes/krisp-webhook/krisp-webhook.ts` →
`api/src/services/krisp-webhook/krisp-webhook.ts`) reads the delivery's `event`,
`data.meeting.{id,title,start_date,url}`, and `data.raw_content` (Krisp's
pre-rendered markdown), ignoring participant emails / `calendar_event_id`. Then:

- **Notes** (`note_generated`, or any trigger name it doesn't recognize) → one
  plain-text email. Subject `Krisp notes: <title> (<date>)`; the body is a short
  header (title, start time, link to the meeting in Krisp) followed by Krisp's
  notes verbatim. Dates are shown in `KRISP_EMAIL_TZ`.
- **Transcript / outline** → `200 {"outcome":"ignored"}` and no email, so each
  meeting produces one email.

Failures come back as HTTP errors (and `krisp_webhook.*` events in the API logs):
**503** when Gmail isn't configured, **502** when Gmail rejects the login
(`EAUTH`) or can't be reached. There's no dedupe — re-sending a meeting from
Krisp emails it again.

## Email setup (Gmail App Password)

No Google Cloud project is involved:

1. Turn on **2-Step Verification** for the Gmail account the notes are sent from.
2. Create an App Password at <https://myaccount.google.com/apppasswords> (copy it —
   Google only shows it once).
3. Add it to `.env` on the host that serves the webhook (prod), then recreate the
   app container so it picks the values up — `scripts/restart-prod.sh` does that.
   `docker-compose.yml` passes these through to the container:

   ```bash
   GMAIL_USER=you@gmail.com
   GMAIL_APP_PASSWORD=abcd efgh ijkl mnop   # spaces are fine — they're stripped
   # KRISP_EMAIL_TO=you@gmail.com           # default: GMAIL_USER
   # KRISP_EMAIL_TZ=America/New_York        # default: America/New_York
   ```

- Send to the Gmail address itself, not an alias that forwards back into the same
  mailbox (e.g. a Cloudflare Email Routing address): Gmail can treat that as a
  copy of a message you sent and keep it out of the inbox.
- Changing your Google password revokes App Passwords. If deliveries start
  failing with `502 … (EAUTH)`, create a new one and update `.env`.

## How it connects

```
Krisp (Settings → Integrations → Webhook)
   └─ POST https://meetings.justcole.com/api/krisp-webhook   (Cloudflare tunnel)
        └─ Cloudflare tunnel → origin
             └─ POST /api/krisp-webhook   ← api/src/routes/krisp-webhook/krisp-webhook.ts
                  └─ Gmail SMTP (smtp.gmail.com:465) → your inbox
```

## Capturing the payload with ngrok

```bash
ngrok http 3200
# → forwards https://<random>.ngrok-free.app  →  http://localhost:3200
```

Set the Krisp **Webhook URL** to `https://<random>.ngrok-free.app/api/krisp-webhook`,
then fire **Send sample note** (webhook's Configure tab) or **Send to Webhook**
(any meeting page). Read the exact request at:

- the **ngrok inspector** — <http://localhost:4040> (full headers + body, replayable), or
- the **API logs** — `docker compose logs -f app-dev | grep krisp_webhook.received`.

## Cloudflare tunnel (the production path)

You do **not** need a second `cloudflared` daemon — a different subdomain is not a
different tunnel. One tunnel serves many hostnames; add `meetings.justcole.com` as
another hostname on the **existing** tunnel, alongside `calendar.justcole.com`,
both pointing at the app origin.

- **Dashboard-managed tunnel** (what `tunnel/docker-compose.yml` runs): Zero Trust →
  Networks → Tunnels → your tunnel → *Public Hostname* → add `meetings.justcole.com`
  → service `http://cram:3200`. The `cram-tunnel` container reaches the app by
  container name on the `cram_default` network; a `cloudflared` installed on the
  host itself would use `http://localhost:3200`. DNS is created for you.
- **Config-file tunnel** (host-installed `cloudflared`): add an `ingress` rule and a
  DNS route:
  ```yaml
  # ~/.cloudflared/config.yml
  ingress:
    - hostname: calendar.justcole.com
      service: http://localhost:3200
    - hostname: meetings.justcole.com   # ← new
      service: http://localhost:3200
    - service: http_status:404
  ```
  ```bash
  cloudflared tunnel route dns <tunnel-name> meetings.justcole.com
  ```

Put the full `/api/krisp-webhook` path in Krisp's webhook URL. The tunnel's
optional *Path* field only filters which requests match the hostname rule; it
never adds a path.

A genuinely *separate* tunnel (its own tunnel id) is the only thing that would
need a second `cloudflared` process — there's no reason to here.

## Auth

Set `KRISP_WEBHOOK_TOKEN` on the API (`.env`) and add a matching header in Krisp's
webhook config — `Authorization: <token>` or `x-krisp-webhook-token: <token>`.
Unset ⇒ the route accepts any request. That's fine for local testing, but every
accepted notes delivery sends an email, so set it before pointing real Krisp
traffic at it.
