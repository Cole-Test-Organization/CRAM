# Top news web app (Google Apps Script)

A **standalone, single-file port** of the CRM's per-account News feature
([api/src/services/news/news.ts](../../api/src/services/news/news.ts)) that runs
entirely inside Google Apps Script — no CRM, no API, no database. Deploy it as
a web app, bookmark the `/exec` URL, and every click fetches Google News for
your configured company and shows the headlines ranked, live (~2s).

Like the calendar exporter, this is the source of truth for a script that runs
*in* Google Apps Script (pasted into the editor — `clasp` is blocked by admin
policy). It's tracked here so it lives in the same repo as the service it mirrors.

## How it relates to the CRM service

```
CRM (per-account News tab)                 This script (bookmarkable link)
──────────────────────────                 ───────────────────────────────
Google News RSS (quoted company query)  =  identical request
regex RSS parse + entity decode         =  XmlService parse (regex parser kept
                                           as fallback — it IS the CRM parser)
dedupe by URL, cap at 40                =  identical
rank via local LLM (Ollama)             ≠  deterministic keyword scoring
store snapshot in Postgres              ≠  nothing stored — always live
per-account prompt overrides            ≠  CONFIG consts + EXTRA_KEYWORDS
```

**Why the ranking is different:** Apps Script executes on Google's servers, so
it can never reach the local LLM on your LAN. Instead, the default ranking
prompt's rubric is encoded as scoring tiers:

| Signal | Points |
|---|---|
| Security incidents (breach, ransomware, CVE, outage, regulator…) | +30 each |
| Leadership & structure (CISO/CxO moves, M&A, funding, layoffs…) | +20 each |
| Strategic signals (launches, cloud, earnings, expansion…) | +10 each |
| Your own terms (`EXTRA_KEYWORDS`) | your choice |
| Company name appears in the headline | +12 |
| Recency (halves every 72h) | up to +15 |
| Listicle / stock-blip phrasing ("top 10", "price target"…) | −25 each |
| Stock-blog sources (Motley Fool, Zacks, Benzinga…) | −20 |

Ties keep Google's feed order — the same fallback the CRM uses when its LLM is
unreachable. Every article in the UI shows **chips explaining exactly why it
scored** (e.g. `ransomware +30 · 6h old +14`), which is the transparency you
give up an LLM judgment for.

## Files

| File | What it is |
|------|------------|
| `top-news-web-app.gs` | The Apps Script. Self-contained — paste into its own Apps Script project (CONFIG consts would collide with the calendar exporter's). |

## Setup

1. **Create the project.** [script.new](https://script.new) → paste
   `top-news-web-app.gs`.
2. **Set CONFIG** at the top of the file: `COMPANY_NAME`, plus any
   `EXTRA_KEYWORDS` (each `{ label, pattern, weight }`; negative weights
   demote). Tier weights and pattern lists are all editable.
3. **Deploy.** Deploy → New deployment → type **Web app** → *Execute as:* Me ·
   *Who has access:* **Only myself**. The first run asks for the
   external-request permission — approve it. No secrets or Script Properties
   are needed; the RSS feed is public.
4. **Bookmark the `/exec` URL.** That's the whole workflow: click → fresh
   fetch + rank.

To sanity-check without deploying, run `testInEditor()` in the editor and read
the Execution log (top 15 with scores and reasons).

> *Who has access: Only myself* requires being signed into that Google account
> in the browser you click from. If you want it on a phone profile or shared
> device, deploy with *Anyone with the link* — the URL is unguessable but
> effectively public, which is fine here (it exposes only public news for a
> company name).

## Usage

- **Click the bookmark** — top stories for `COMPANY_NAME`.
- **`?company=Other+Co`** — one-off override for any other company (the page
  also has an inline search box). Quotes are added for you (exact-name query).
- **`?format=json`** — machine-readable output (rank, score, reasons per
  article), shaped like the CRM's `GET /api/accounts/:id/news` read.

## Tuning

The score chips make bad rankings diagnosable: if junk floats up, its chips
tell you which pattern to demote; if something you care about sinks, add an
`EXTRA_KEYWORDS` entry for it. Editing the `.gs` in the Apps Script editor
takes effect on the next click for a test deployment — for a versioned web-app
deployment, use Deploy → Manage deployments → Edit → **New version** (or keep a
head `/dev` URL bookmarked instead).
