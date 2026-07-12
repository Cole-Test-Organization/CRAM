// Per-account news.
//
// Flow: fetch Google News RSS for the account's *company name* (not the slug),
// then hand the headlines to the user's configured local LLM to RANK them —
// the model returns an ordering only; it never rewrites or invents content. We
// store just headline + link + source + date (no article bodies) and replace
// the snapshot wholesale on each refresh.
//
// Refresh is manual (a button, or the daily scheduler for favorite/"starred"
// accounts) — never automatic on tab open — so opening a non-starred account
// doesn't silently fire a 10-30s local-LLM call. `getNews` is a pure read.
//
// The ranking prompt resolves per call: account override → global (per-user) →
// built-in default. All three storage tables are per-user RLS.

import type { PoolClient } from 'pg';
import { getPool, withUser } from '../../db/connection.js';
import { logger as rootLogger } from '../../lib/logger.js';
import * as localProvider from '../../agent/providers/local.js';
import { parseLooseJson, sleep } from '../_shared/_llm.js';
import { decodeEntities } from '../_shared/_html.js';
import type { AccountsService } from '../accounts/accounts.js';
import type { AgentSettingsService } from '../agent/agent-settings.js';

const logger = rootLogger.child({ component: 'news' });

// Bound the local-LLM ranking call (a slow/loading box shouldn't hang a refresh
// forever) and cap how many headlines we fetch/rank/store. All env-overridable.
const LLM_TIMEOUT_MS = Number(process.env.NEWS_RANK_LLM_TIMEOUT_MS) || 120_000;
const RSS_TIMEOUT_MS = Number(process.env.NEWS_RSS_TIMEOUT_MS) || 15_000;
const MAX_ARTICLES = Number(process.env.NEWS_MAX_ARTICLES) || 40;
// Gap between accounts when the scheduler refreshes every favorite, so a user
// with many starred accounts doesn't hammer the local LLM / Google News.
const FAVORITE_REFRESH_GAP_MS = Number(process.env.NEWS_FAVORITE_REFRESH_GAP_MS) || 2000;

// The built-in default ranking prompt. Stored settings NULL out to this (we don't
// seed it into the DB — same "null means default" contract as the agent system
// prompt), so editing it here changes what every un-customized account uses.
export const DEFAULT_NEWS_RANKING_PROMPT = `You are helping a cybersecurity sales engineer triage recent news about a company they sell to. You will receive a JSON array of news headlines, each with an id, title, source, and date. Rank them from MOST to LEAST relevant for the SE's next conversation with this account.

Prioritize, roughly in this order:
- Security incidents: breaches, ransomware, data leaks, outages, CVEs, regulatory/compliance actions
- Leadership & structure: executive changes (esp. CISO/CIO/CxO), M&A, funding, layoffs, restructuring
- Strategic signals: major product launches, cloud / digital-transformation initiatives, earnings, expansion

Deprioritize:
- Generic listicles, thin press-release reposts, and stock-price blips
- Items that clearly refer to a different company that happens to share the name

Return ONLY a JSON object of the form {"ranked": [ids in best-to-worst order]}. Include every id exactly once, no duplicates. No prose, no code fences.`;

export interface RawArticle {
  title: string;
  url: string;
  source: string | null;
  published_at: string | null; // ISO 8601, or null if the feed date was unparseable
}

type RefreshStatus = 'refreshing' | 'ok' | 'error';

export interface NewsRefreshResult {
  account_id: number;
  status: RefreshStatus;
  article_count?: number;
  error?: string;
  already_running?: boolean;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Empty/whitespace-only clears a customization → null → the fallback applies.
function normalizePrompt(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export class NewsService {
  private readonly accountsService: AccountsService;
  private readonly agentSettingsService: AgentSettingsService;
  // Accounts being refreshed in THIS process — dedupes a double-click or an
  // overlapping scheduler pass. Cross-replica, the 'refreshing' status row is the
  // visible signal and a rare duplicate refresh is harmless (the snapshot is
  // replaced wholesale, so the last writer just wins).
  private readonly inFlight = new Set<number>();

  constructor({
    accountsService,
    agentSettingsService,
  }: {
    accountsService: AccountsService;
    agentSettingsService: AgentSettingsService;
  }) {
    this.accountsService = accountsService;
    this.agentSettingsService = agentSettingsService;
  }

  // ── global (per-user) ranking-prompt settings ──────────────────────────────

  async getSettings(userId: number) {
    return withUser(userId, (client) => this.readSettings(client));
  }

  async updateSettings(userId: number, patch: { ranking_prompt?: string | null }) {
    const prompt = normalizePrompt(patch?.ranking_prompt);
    return withUser(userId, async (client) => {
      await client.query(
        `INSERT INTO user_news_settings (user_id, ranking_prompt)
         VALUES (current_setting('app.current_user_id')::bigint, $1)
         ON CONFLICT (user_id) DO UPDATE SET ranking_prompt = EXCLUDED.ranking_prompt`,
        [prompt],
      );
      // Read back on the SAME client so the response reflects the write (a fresh
      // withUser would open a new transaction that can't see this uncommitted row).
      return this.readSettings(client);
    });
  }

  private async readSettings(client: PoolClient) {
    const row = (
      await client.query(
        `SELECT ranking_prompt, updated_at FROM user_news_settings
         WHERE user_id = current_setting('app.current_user_id')::bigint`,
      )
    ).rows[0];
    return {
      ranking_prompt: row?.ranking_prompt ?? null,
      default_ranking_prompt: DEFAULT_NEWS_RANKING_PROMPT,
      updated_at: row?.updated_at ?? null,
    };
  }

  // ── per-account read + override ────────────────────────────────────────────

  // Pure read: the stored snapshot + last-refresh status + this account's prompt
  // override. Never fetches. Returns null when the account doesn't exist / isn't
  // visible to this user (→ 404 upstream).
  async getNews(userId: number, accountId: number) {
    return withUser(userId, (client) => this.readNews(client, accountId));
  }

  async updateAccountSettings(
    userId: number,
    accountId: number,
    patch: { ranking_prompt?: string | null },
  ) {
    const prompt = normalizePrompt(patch?.ranking_prompt);
    return withUser(userId, async (client) => {
      const account = (await client.query(`SELECT id FROM accounts WHERE id = $1`, [accountId]))
        .rows[0];
      if (!account) return null;
      await client.query(
        `INSERT INTO account_news_settings (account_id, user_id, ranking_prompt)
         VALUES ($1, current_setting('app.current_user_id')::bigint, $2)
         ON CONFLICT (account_id) DO UPDATE SET ranking_prompt = EXCLUDED.ranking_prompt`,
        [accountId, prompt],
      );
      // Same-client read-back so the response carries the just-written override.
      return this.readNews(client, accountId);
    });
  }

  private async readNews(client: PoolClient, accountId: number) {
    const account = (
      await client.query(`SELECT id, name, favorite FROM accounts WHERE id = $1`, [accountId])
    ).rows[0];
    if (!account) return null;

    const settings =
      (
        await client.query(
          `SELECT ranking_prompt, last_status, last_error, last_fetched_at, article_count
           FROM account_news_settings WHERE account_id = $1`,
          [accountId],
        )
      ).rows[0] || null;

    const articles = (
      await client.query(
        `SELECT id, title, url, source, published_at, rank
         FROM account_news WHERE account_id = $1 ORDER BY rank ASC, id ASC`,
        [accountId],
      )
    ).rows;

    return {
      account_id: account.id,
      account_name: account.name,
      favorite: account.favorite,
      status: (settings?.last_status ?? null) as RefreshStatus | null, // null = never fetched
      error: settings?.last_error ?? null,
      last_fetched_at: settings?.last_fetched_at ?? null,
      article_count: settings?.article_count ?? articles.length,
      ranking_prompt: settings?.ranking_prompt ?? null, // per-account override (null = use global)
      articles,
    };
  }

  // ── refresh ────────────────────────────────────────────────────────────────

  // Fire-and-forget for the HTTP layer: verify the account, flip status to
  // 'refreshing' synchronously (so an immediate re-poll reflects it), then run the
  // fetch+rank+store in the background. Returns 202-shaped data at once; the GUI
  // polls getNews() until status settles. Returns null → 404.
  async startRefresh(userId: number, accountId: number): Promise<NewsRefreshResult | null> {
    const account = await this.requireAccount(userId, accountId);
    if (!account) return null;
    if (this.inFlight.has(accountId)) {
      return { account_id: accountId, status: 'refreshing', already_running: true };
    }
    await this.setStatus(userId, accountId, 'refreshing', null);
    void this.refresh(userId, accountId, account.name).catch((err) =>
      logger.error({ accountId, err: errMessage(err) }, 'background news refresh crashed'),
    );
    return { account_id: accountId, status: 'refreshing', already_running: false };
  }

  // Awaitable variant used by the scheduler (favorite refresh) — runs the whole
  // pipeline to completion. Returns null → account gone.
  async runRefresh(userId: number, accountId: number): Promise<NewsRefreshResult | null> {
    const account = await this.requireAccount(userId, accountId);
    if (!account) return null;
    return this.refresh(userId, accountId, account.name);
  }

  // Daily scheduler entry point: refresh news for every favorite ("starred")
  // account across all active users, serially with a small gap.
  async refreshAllFavorites(): Promise<{ users: number; accounts: number; ok: number; failed: number }> {
    const users = (await getPool().query(`SELECT id FROM users WHERE disabled_at IS NULL`)).rows.map(
      (r: { id: number }) => Number(r.id),
    );
    let accounts = 0;
    let ok = 0;
    let failed = 0;
    for (const userId of users) {
      let favorites: Array<{ id: number; name: string }> = [];
      try {
        favorites = await withUser(userId, async (client) =>
          (await client.query(`SELECT id, name FROM accounts WHERE favorite = true ORDER BY id`)).rows,
        );
      } catch (err) {
        logger.error({ userId, err: errMessage(err) }, 'failed to list favorite accounts');
        continue;
      }
      for (const account of favorites) {
        accounts++;
        const result = await this.runRefresh(userId, account.id);
        if (result?.status === 'ok') ok++;
        else failed++;
        if (FAVORITE_REFRESH_GAP_MS > 0) await sleep(FAVORITE_REFRESH_GAP_MS);
      }
    }
    logger.info({ users: users.length, accounts, ok, failed }, 'favorite news refresh complete');
    return { users: users.length, accounts, ok, failed };
  }

  // The actual pipeline: fetch → rank → replace snapshot → record status. Guarded
  // by the in-flight set so overlapping triggers collapse to one run.
  private async refresh(userId: number, accountId: number, accountName: string): Promise<NewsRefreshResult> {
    if (this.inFlight.has(accountId)) {
      return { account_id: accountId, status: 'refreshing', already_running: true };
    }
    this.inFlight.add(accountId);
    try {
      await this.setStatus(userId, accountId, 'refreshing', null);
      const fetched = await this.fetchGoogleNews(accountName);
      const ranked = await this.rankArticles(userId, accountId, fetched);
      await this.store(userId, accountId, ranked);
      await this.setStatus(userId, accountId, 'ok', null, ranked.length);
      logger.info({ accountId, count: ranked.length }, 'news refreshed');
      return { account_id: accountId, status: 'ok', article_count: ranked.length };
    } catch (err) {
      const msg = errMessage(err);
      logger.warn({ accountId, err: msg }, 'news refresh failed');
      await this.setStatus(userId, accountId, 'error', msg).catch(() => {});
      return { account_id: accountId, status: 'error', error: msg };
    } finally {
      this.inFlight.delete(accountId);
    }
  }

  private async requireAccount(
    userId: number,
    accountId: number,
  ): Promise<{ id: number; name: string } | null> {
    return withUser(
      userId,
      async (client) =>
        (await client.query(`SELECT id, name FROM accounts WHERE id = $1`, [accountId])).rows[0] || null,
    );
  }

  // Upsert the per-account status row without clobbering the prompt override. On a
  // successful refresh we also stamp last_fetched_at + article_count; 'refreshing'
  // / 'error' leave those alone (so the UI keeps showing the previous fetch time).
  private async setStatus(
    userId: number,
    accountId: number,
    status: RefreshStatus,
    error: string | null,
    articleCount?: number,
  ): Promise<void> {
    await withUser(userId, async (client) => {
      if (status === 'ok') {
        await client.query(
          `INSERT INTO account_news_settings (account_id, user_id, last_status, last_error, last_fetched_at, article_count)
           VALUES ($1, current_setting('app.current_user_id')::bigint, 'ok', NULL, NOW(), $2)
           ON CONFLICT (account_id) DO UPDATE
             SET last_status = 'ok', last_error = NULL, last_fetched_at = NOW(), article_count = EXCLUDED.article_count`,
          [accountId, articleCount ?? 0],
        );
      } else {
        await client.query(
          `INSERT INTO account_news_settings (account_id, user_id, last_status, last_error)
           VALUES ($1, current_setting('app.current_user_id')::bigint, $2, $3)
           ON CONFLICT (account_id) DO UPDATE
             SET last_status = EXCLUDED.last_status, last_error = EXCLUDED.last_error`,
          [accountId, status, error],
        );
      }
    });
  }

  private async store(userId: number, accountId: number, ranked: RawArticle[]): Promise<void> {
    // One transaction (withUser wraps BEGIN/COMMIT) so the replace is atomic — a
    // reader never sees a half-cleared snapshot.
    await withUser(userId, async (client) => {
      await client.query(`DELETE FROM account_news WHERE account_id = $1`, [accountId]);
      for (let i = 0; i < ranked.length; i++) {
        const a = ranked[i];
        await client.query(
          `INSERT INTO account_news (user_id, account_id, title, url, source, published_at, rank)
           VALUES (current_setting('app.current_user_id')::bigint, $1, $2, $3, $4, $5, $6)`,
          [accountId, a.title, a.url, a.source, a.published_at, i],
        );
      }
    });
  }

  // Fetch Google News RSS for the exact company name (quoted → exact-ish match).
  // Plain fetch — NOT the local provider's insecure LAN dispatcher — since this is
  // a public HTTPS endpoint.
  private async fetchGoogleNews(name: string): Promise<RawArticle[]> {
    const q = encodeURIComponent(`"${name}"`);
    const url = `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; se-operating-system-news/1.0)' },
      signal: AbortSignal.timeout(RSS_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Google News RSS returned HTTP ${res.status}`);
    const xml = await res.text();
    return parseGoogleNewsRss(xml).slice(0, MAX_ARTICLES);
  }

  // Ask the configured local LLM to rank the headlines. The model returns an
  // ordering of ids only. Any failure — settings unresolved, LLM unreachable,
  // unparseable output — falls back to the original feed order so news still shows.
  private async rankArticles(
    userId: number,
    accountId: number,
    articles: RawArticle[],
  ): Promise<RawArticle[]> {
    if (articles.length <= 1) return articles;

    let model: string;
    let baseUrl: string;
    try {
      const eff = await this.agentSettingsService.getEffective(userId);
      model = eff.model;
      baseUrl = eff.local_base_url;
    } catch (err) {
      logger.warn({ accountId, err: errMessage(err) }, 'agent settings unresolved; using feed order');
      return articles;
    }

    const system = await this.resolvePrompt(userId, accountId);
    const payload = articles.map((a, i) => ({ id: i, title: a.title, source: a.source, date: a.published_at }));
    const userPrompt = `Headlines (JSON):\n${JSON.stringify(payload)}\n\nReturn ONLY {"ranked": [ids best-to-worst]}.`;

    try {
      const turn = await localProvider.streamTurn({
        model,
        system,
        messages: [{ role: 'user', content: userPrompt }],
        mcpTools: [], // no tool-calling — a one-shot completion
        providerConfig: { baseUrl },
        timeoutMs: LLM_TIMEOUT_MS,
      });
      const text = (turn?.content || [])
        .filter((b: { type?: string }) => b?.type === 'text')
        .map((b: { text?: string }) => b.text || '')
        .join('')
        .trim();
      const parsed = parseLooseJson<{ ranked?: unknown }>(text);
      const order = Array.isArray(parsed?.ranked) ? parsed!.ranked : null;
      if (!order) {
        logger.warn({ accountId }, 'ranking output unusable; using feed order');
        return articles;
      }
      return applyOrder(articles, order);
    } catch (err) {
      logger.warn({ accountId, err: errMessage(err) }, 'ranking call failed; using feed order');
      return articles;
    }
  }

  // account override → global (per-user) → built-in default.
  private async resolvePrompt(userId: number, accountId: number): Promise<string> {
    return withUser(userId, async (client) => {
      const account = (
        await client.query(`SELECT ranking_prompt FROM account_news_settings WHERE account_id = $1`, [
          accountId,
        ])
      ).rows[0];
      if (account?.ranking_prompt) return account.ranking_prompt;
      const global = (
        await client.query(
          `SELECT ranking_prompt FROM user_news_settings
           WHERE user_id = current_setting('app.current_user_id')::bigint`,
        )
      ).rows[0];
      if (global?.ranking_prompt) return global.ranking_prompt;
      return DEFAULT_NEWS_RANKING_PROMPT;
    });
  }
}

// Reorder `articles` by the model's list of ids (0-based indices). Invalid /
// out-of-range / duplicate ids are ignored, and any article the model omitted is
// appended in its original position so nothing is silently dropped. Exported for
// tests.
export function applyOrder(articles: RawArticle[], order: unknown[]): RawArticle[] {
  const used = new Set<number>();
  const out: RawArticle[] = [];
  for (const raw of order) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id < 0 || id >= articles.length || used.has(id)) continue;
    used.add(id);
    out.push(articles[id]);
  }
  for (let i = 0; i < articles.length; i++) {
    if (!used.has(i)) out.push(articles[i]);
  }
  return out;
}

// ── Google News RSS parsing (dependency-free) ────────────────────────────────
// Google News RSS is simple, stable RSS 2.0; a small regex parse avoids pulling
// in an XML dependency (which would force a Docker rebuild). Exported for tests.

export function parseGoogleNewsRss(xml: string): RawArticle[] {
  const items: RawArticle[] = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRe.exec(xml)) !== null) {
    const block = match[1];
    const title = decodeEntities(stripCdata(extractTag(block, 'title')) || '').trim();
    const url = decodeEntities(stripCdata(extractTag(block, 'link')) || '').trim();
    if (!title || !url) continue;
    const source = decodeEntities(stripCdata(extractTag(block, 'source')) || '').trim() || null;
    const pubDate = stripCdata(extractTag(block, 'pubDate'));
    items.push({ title, url, source, published_at: toIso(pubDate) });
  }
  // Dedupe by URL — the feed occasionally repeats a story.
  const seen = new Set<string>();
  return items.filter((a) => (seen.has(a.url) ? false : (seen.add(a.url), true)));
}

function extractTag(block: string, tag: string): string | null {
  // [^>]* tolerates attributes, e.g. <source url="https://reuters.com">Reuters</source>.
  const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1] : null;
}

function stripCdata(s: string | null): string | null {
  if (s == null) return null;
  const m = s.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return m ? m[1] : s;
}

function toIso(rfc822: string | null): string | null {
  if (!rfc822) return null;
  const d = new Date(rfc822.trim());
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
