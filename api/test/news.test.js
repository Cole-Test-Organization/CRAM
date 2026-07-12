import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { get, post, patch, makeAccount } from './helpers.js';
import {
  parseGoogleNewsRss,
  applyOrder,
  DEFAULT_NEWS_RANKING_PROMPT,
} from '../src/services/news/news.js';
import { Scheduler, duePeriodKey } from '../src/services/scheduler/scheduler.js';
import { getPool } from '../src/db/connection.js';

// ── pure units (no DB / no network) ──────────────────────────────────────────

describe('News — Google News RSS parsing', () => {
  const XML = `<?xml version="1.0"?><rss version="2.0"><channel>
    <item>
      <title>Acme Corp hit by ransomware &amp; data leak</title>
      <link>https://news.google.com/rss/articles/AAA?oc=5</link>
      <guid isPermaLink="false">AAA</guid>
      <pubDate>Wed, 09 Jul 2025 12:00:00 GMT</pubDate>
      <source url="https://www.reuters.com">Reuters</source>
    </item>
    <item>
      <title><![CDATA[Acme & Partners expand cloud footprint]]></title>
      <link>https://news.google.com/rss/articles/CCC</link>
      <pubDate>not-a-real-date</pubDate>
    </item>
    <item>
      <title>Duplicate of the first story</title>
      <link>https://news.google.com/rss/articles/AAA?oc=5</link>
      <pubDate>Wed, 09 Jul 2025 12:00:00 GMT</pubDate>
    </item>
  </channel></rss>`;

  it('extracts title/link/source/date, decodes entities + CDATA, dedupes by URL', () => {
    const items = parseGoogleNewsRss(XML);
    // Third <item> shares the first's URL → deduped away.
    assert.equal(items.length, 2);

    const [first, second] = items;
    assert.equal(first.title, 'Acme Corp hit by ransomware & data leak'); // &amp; decoded
    assert.equal(first.url, 'https://news.google.com/rss/articles/AAA?oc=5');
    assert.equal(first.source, 'Reuters');
    assert.equal(first.published_at, new Date('Wed, 09 Jul 2025 12:00:00 GMT').toISOString());

    assert.equal(second.title, 'Acme & Partners expand cloud footprint'); // CDATA stripped
    assert.equal(second.source, null); // no <source> tag
    assert.equal(second.published_at, null); // unparseable date → null
  });

  it('returns [] for junk / empty input', () => {
    assert.deepEqual(parseGoogleNewsRss(''), []);
    assert.deepEqual(parseGoogleNewsRss('<rss><channel></channel></rss>'), []);
  });
});

describe('News — applyOrder (LLM ranking → reordering)', () => {
  const arts = [{ title: 'a' }, { title: 'b' }, { title: 'c' }, { title: 'd' }];

  it('reorders by id and appends anything the model omitted', () => {
    const out = applyOrder(arts, [2, 0]);
    assert.deepEqual(out.map((x) => x.title), ['c', 'a', 'b', 'd']);
  });

  it('ignores out-of-range, non-integer, and duplicate ids', () => {
    const out = applyOrder(arts, [9, -1, 'x', 1, 1]);
    assert.deepEqual(out.map((x) => x.title), ['b', 'a', 'c', 'd']);
  });

  it('empty order preserves feed order; every article appears exactly once', () => {
    const out = applyOrder(arts, []);
    assert.deepEqual(out.map((x) => x.title), ['a', 'b', 'c', 'd']);
  });
});

describe('Scheduler — duePeriodKey (daily, timezone-aware)', () => {
  const daily9ET = { kind: 'daily', hour: 9, minute: 0, tz: 'America/New_York' };

  it('is due once local wall-clock reaches the trigger, keyed by local date', () => {
    // 13:30Z = 09:30 EDT → due, period = that NY date.
    assert.equal(duePeriodKey(daily9ET, new Date('2025-07-09T13:30:00Z')), '2025-07-09');
    // 12:30Z = 08:30 EDT → before 9am → not yet due.
    assert.equal(duePeriodKey(daily9ET, new Date('2025-07-09T12:30:00Z')), null);
    // 02:00Z on the 9th = 22:00 EDT on the 8th → due, period is the 8th (not the 9th).
    assert.equal(duePeriodKey(daily9ET, new Date('2025-07-09T02:00:00Z')), '2025-07-08');
  });
});

// ── HTTP integration (live seeded API) ───────────────────────────────────────

describe('News — global ranking-prompt settings', () => {
  it('GET returns the built-in default; PATCH sets, persists, and clears', async () => {
    const initial = await get('/news/settings');
    assert.equal(initial.status, 200);
    assert.equal(typeof initial.body.default_ranking_prompt, 'string');
    assert.ok(initial.body.default_ranking_prompt.length > 0);
    assert.equal(initial.body.default_ranking_prompt, DEFAULT_NEWS_RANKING_PROMPT);

    try {
      const set = await patch('/news/settings', { ranking_prompt: 'zzz-test custom ranking' });
      assert.equal(set.status, 200);
      assert.equal(set.body.ranking_prompt, 'zzz-test custom ranking'); // same-tx read-back

      const reread = await get('/news/settings');
      assert.equal(reread.body.ranking_prompt, 'zzz-test custom ranking');

      // Whitespace-only normalizes to null (revert to default).
      const blanked = await patch('/news/settings', { ranking_prompt: '   ' });
      assert.equal(blanked.body.ranking_prompt, null);
    } finally {
      // Restore the default user's baseline so other runs/tests see a clean row.
      await patch('/news/settings', { ranking_prompt: null });
    }
  });
});

describe('News — per-account read + prompt override', () => {
  it('GET returns an empty, never-fetched snapshot for a fresh account', async (t) => {
    const { body: acct } = await makeAccount(t);
    const res = await get(`/accounts/${acct.id}/news`);
    assert.equal(res.status, 200);
    assert.equal(res.body.account_id, acct.id);
    assert.equal(res.body.account_name, acct.name);
    assert.equal(res.body.favorite, false);
    assert.equal(res.body.status, null); // never fetched
    assert.equal(res.body.ranking_prompt, null); // no override
    assert.deepEqual(res.body.articles, []); // no refresh performed
  });

  it('PATCH sets + clears a per-account ranking prompt override', async (t) => {
    const { body: acct } = await makeAccount(t);
    const set = await patch(`/accounts/${acct.id}/news`, { ranking_prompt: 'zzz-test account rank' });
    assert.equal(set.status, 200);
    assert.equal(set.body.ranking_prompt, 'zzz-test account rank');

    const reread = await get(`/accounts/${acct.id}/news`);
    assert.equal(reread.body.ranking_prompt, 'zzz-test account rank');

    const cleared = await patch(`/accounts/${acct.id}/news`, { ranking_prompt: null });
    assert.equal(cleared.body.ranking_prompt, null);
    // account_news_settings row is cascade-cleaned when the throwaway account is deleted.
  });

  it('404s for a non-existent account on get / refresh / patch', async () => {
    const ghost = 999999999;
    assert.equal((await get(`/accounts/${ghost}/news`)).status, 404);
    assert.equal((await post(`/accounts/${ghost}/news/refresh`)).status, 404);
    assert.equal((await patch(`/accounts/${ghost}/news`, { ranking_prompt: 'x' })).status, 404);
  });
});

// ── scheduler claim-once (DB) ────────────────────────────────────────────────

describe('Scheduler — claims each occurrence exactly once', () => {
  it('runs a due task once across repeated ticks and records a completed run', async (t) => {
    const taskName = `zzz-test-sched-${Date.now()}`;
    t.after(async () => {
      await getPool().query('DELETE FROM scheduled_task_runs WHERE task_name = $1', [taskName]);
    });

    let runs = 0;
    const sched = new Scheduler({ pollMs: 60_000 });
    sched.register({
      name: taskName,
      // hour 0 → always past the trigger, so every tick is "due".
      schedule: { kind: 'daily', hour: 0, minute: 0, tz: 'UTC' },
      handler: async () => {
        runs += 1;
      },
    });

    const now = new Date('2025-07-09T10:00:00Z'); // period_key = 2025-07-09 (UTC)
    await sched.tick(now);
    await sched.tick(now); // same period → claim conflict → must NOT re-run
    assert.equal(runs, 1);

    const rows = await getPool().query(
      'SELECT status, period_key FROM scheduled_task_runs WHERE task_name = $1',
      [taskName],
    );
    assert.equal(rows.rowCount, 1);
    assert.equal(rows.rows[0].status, 'completed');
    assert.equal(rows.rows[0].period_key, '2025-07-09');
  });
});

// The scheduler test opens the module-singleton pool in this test process; close
// it so the runner exits promptly.
after(async () => {
  await getPool().end().catch(() => {});
});
