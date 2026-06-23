# Krisp webhook ingestion

The **receiving side** of Krisp meeting-output ingestion. [Krisp](https://krisp.ai)
fires a webhook when a meeting's **transcript**, **notes** (key points / action
items), or **outline** is generated, and POSTs JSON to the CRM.

There is no client code to host here — Krisp is the sender; this is the endpoint
contract + setup notes. The endpoint is **deterministic / machine-to-machine**
(no LLM, not agent- or MCP-callable) — see the `krisp-webhook` exception in
[CLAUDE.md](../CLAUDE.md).

## How the import works

`POST /api/krisp-webhook` parses the delivery (`event`, `data.meeting.{id,title,
start_date,end_date}`, and `data.raw_content` — Krisp's pre-rendered markdown),
**ignoring participant emails / `calendar_event_id` entirely** (those only appear
when Krisp is wired to Google Calendar, which we don't rely on). It then:

1. **Dedupes by the Krisp meeting id** — if a meeting already carries this
   `krisp_meeting_id` (a re-delivery, or a follow-up event like the transcript
   after the note), it appends to that row. Each event is wrapped in a hidden
   marker (`<!-- krisp:note -->`), so a re-sent event is a no-op.
2. **Time-proximity match** — finds the existing meeting (e.g. one
   `calendar-import` created) whose **start** is within ±`KRISP_MATCH_WINDOW_MIN`
   (default 10 min) of Krisp's start; ties broken by largest overlap. Matching
   gates on **start, never end** (meetings run short/long). On a confident match
   it appends the notes, links the `krisp_meeting_id`, and flags `needs_review`
   so you can verify the match.
3. **No confident match** → parks a **new** meeting (`internal`, `needs_review`)
   with the notes. You can later fold it onto the real meeting with the generic
   **merge** (select both meetings in the GUI → *Merge 2*, or the `merge` MCP
   tool / `POST /api/merge/meetings`). The merge carries the `krisp_meeting_id`
   onto the survivor, so a later transcript event still lands on the right row.

The meeting almost always already exists (`calendar-import` makes it from Google
Calendar), so steps 1–2 are the common path; step 3 is the fallback for
postponed/untimed meetings.

## How it connects

```
Krisp (Settings → Integrations → Webhook)
   └─ POST https://meetings.justcole.com/api/krisp-webhook   (Cloudflare tunnel)
        └─ Cloudflare tunnel → origin
             └─ POST /api/krisp-webhook   ← api/src/routes/krisp-webhook/krisp-webhook.ts
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
both pointing at the app origin (`http://localhost:3200`).

- **Dashboard-managed tunnel:** Zero Trust → Networks → Tunnels → your tunnel →
  *Public Hostname* → add `meetings.justcole.com` → service `http://localhost:3200`.
  DNS is created for you.
- **Config-file tunnel:** add an `ingress` rule and a DNS route:
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

A genuinely *separate* tunnel (its own tunnel id) is the only thing that would
need a second `cloudflared` process — there's no reason to here.

## Auth (optional)

Set `KRISP_WEBHOOK_TOKEN` on the API (`.env`) and add a matching header in Krisp's
webhook config — `Authorization: <token>` or `x-krisp-webhook-token: <token>`.
Unset ⇒ the route accepts any request (fine for local testing; set it before
pointing real Krisp traffic at it).
