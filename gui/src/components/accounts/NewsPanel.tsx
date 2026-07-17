import { createEffect, createResource, createSignal, For, onCleanup, Show } from 'solid-js';
import { api } from '../../lib/api';
import Button from '../Button';
import { formatRelative } from '../../utils/date';
import { isOffline } from '../../lib/offline';

// Per-account News tab. Read-only until the user refreshes — a refresh fetches
// Google News headlines and re-ranks them on the local LLM, which can take
// 10-30s, so it's async: POST returns 202 and we poll GET until the server's
// status settles ('ok'/'error'). Starred (favorite) accounts also get refreshed
// automatically each morning by the scheduler.
export default function NewsPanel(props: { accountId: number }) {
  const [data, { mutate }] = createResource(() => props.accountId, (id) => api.getAccountNews(id));

  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal<string | null>(null);
  const [showPrompt, setShowPrompt] = createSignal(false);

  const status = () => data()?.status ?? null;
  const articles = () => data()?.articles ?? [];
  const isRefreshing = () => busy() || status() === 'refreshing';

  let pollTimer: number | undefined;
  const stopPoll = () => {
    if (pollTimer !== undefined) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  };
  onCleanup(stopPoll);

  const poll = () => {
    if (pollTimer !== undefined) return; // already polling
    pollTimer = window.setInterval(async () => {
      const fresh = await api.getAccountNews(props.accountId).catch(() => null);
      if (fresh) mutate(fresh);
      if (!fresh || fresh.status !== 'refreshing') {
        stopPoll();
        setBusy(false);
      }
    }, 2500);
  };

  // Pick up an in-flight refresh started elsewhere (the morning job, another tab).
  createEffect(() => {
    if (status() === 'refreshing' && !isOffline()) poll();
  });

  const refresh = async () => {
    setErr(null);
    setBusy(true);
    try {
      await api.refreshAccountNews(props.accountId);
      const cur = data();
      if (cur) mutate({ ...cur, status: 'refreshing' }); // reflect immediately
      poll();
    } catch (e: any) {
      setErr(e?.message || 'Refresh failed');
      setBusy(false);
    }
  };

  return (
    <div>
      <div class="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div class="flex items-center gap-3 flex-wrap">
          <h3 class="text-[13px] font-bold uppercase tracking-widest text-surf-300 font-[family-name:var(--font-display)]">
            News
          </h3>
          <Show when={data()?.last_fetched_at}>
            <span class="text-base-400 text-[11px]">Refreshed {formatRelative(data()!.last_fetched_at!)}</span>
          </Show>
          <Show when={data()?.favorite}>
            <span
              class="text-[10px] uppercase tracking-wider text-amber-300"
              title="Starred accounts are refreshed automatically at the start of each business day"
            >
              ★ auto-refreshed daily
            </span>
          </Show>
        </div>
        <div class="flex gap-2 flex-wrap">
          <button type="button" class="press press-ghost press-sm" onClick={() => setShowPrompt((v) => !v)}>
            {showPrompt() ? 'Hide ranking prompt' : 'Ranking prompt'}
          </button>
          <Button variant="primary" size="sm" disabled={isRefreshing() || isOffline()} onClick={refresh} title={isOffline() ? 'Reconnect to refresh news' : undefined}>
            {isRefreshing() ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>

      <Show when={showPrompt()}>
        <AccountRankingPrompt
          accountId={props.accountId}
          current={data()?.ranking_prompt ?? null}
          onSaved={(p) => {
            const c = data();
            if (c) mutate({ ...c, ranking_prompt: p });
          }}
        />
      </Show>

      <Show when={err()}>
        <div class="mb-3 text-[12px] font-semibold text-scarlet-400">{err()}</div>
      </Show>
      <Show when={status() === 'error' && data()?.error}>
        <div class="mb-3 p-3 border-2 border-scarlet-500/50 bg-scarlet-500/10 text-scarlet-300 text-[12px]">
          Last refresh failed: {data()!.error}
        </div>
      </Show>

      <Show when={!data.loading} fallback={<div class="text-base-300 text-center p-10 text-sm">Loading news…</div>}>
        <Show when={isRefreshing() && articles().length === 0}>
          <div class="text-base-300 text-center p-10 text-sm">
            Fetching &amp; ranking the latest headlines… this runs on your local model and can take up to ~30s.
          </div>
        </Show>

        <Show when={!(isRefreshing() && articles().length === 0)}>
          <div class="panel panel-accent">
            <For
              each={articles()}
              fallback={
                <div class="text-base-300 text-center p-10 text-sm italic">
                  {status() == null
                    ? 'No news yet — click Refresh to fetch the latest headlines.'
                    : 'No recent news found for this company.'}
                </div>
              }
            >
              {(a) => (
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="flex flex-col gap-1 p-3 no-underline border-b border-base-700 last:border-b-0 hover:bg-base-800/40 transition-colors"
                >
                  <span class="font-semibold text-sm text-base-50">{a.title}</span>
                  <span class="text-base-400 text-[11px] flex gap-2 flex-wrap">
                    <Show when={a.source}>
                      <span>{a.source}</span>
                    </Show>
                    <Show when={a.published_at}>
                      <span>· {formatRelative(a.published_at!)}</span>
                    </Show>
                  </span>
                </a>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}

// Collapsible per-account ranking-prompt override. Empty = fall back to the
// global ranking prompt (Settings → News Ranking). The parent owns the current
// value (from the news payload) and is notified on save.
function AccountRankingPrompt(props: {
  accountId: number;
  current: string | null;
  onSaved: (prompt: string | null) => void;
}) {
  const [value, setValue] = createSignal(props.current ?? '');
  const [saving, setSaving] = createSignal(false);
  const [msg, setMsg] = createSignal<string | null>(null);

  // Reseed the box when switching accounts, but not on same-account re-renders
  // (which would clobber an in-progress edit).
  let lastId = props.accountId;
  createEffect(() => {
    if (props.accountId !== lastId) {
      lastId = props.accountId;
      setValue(props.current ?? '');
    }
  });

  const isCustom = () => (props.current ?? '') !== '';

  const save = async (clear = false) => {
    setSaving(true);
    setMsg(null);
    try {
      const prompt = clear ? null : value().trim() || null;
      const res = await api.patchAccountNewsPrompt(props.accountId, prompt);
      props.onSaved(res.ranking_prompt ?? null);
      if (clear) setValue('');
      setMsg(prompt == null ? 'Using the global ranking prompt' : 'Saved for this account');
      setTimeout(() => setMsg(null), 4000);
    } catch (e: any) {
      setMsg(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="panel panel-accent p-4 mb-4 flex flex-col gap-3">
      <span
        class={`text-[10px] uppercase tracking-wider font-semibold ${
          isCustom() ? 'text-amber-300' : 'text-base-400'
        }`}
      >
        {isCustom() ? 'Custom ranking for this account' : 'Using the global ranking prompt'}
      </span>
      <p class="text-base-300 text-[12px]">
        Override how this account's news is prioritized. Leave empty to use your global ranking prompt
        (Settings → News Ranking).
      </p>
      <textarea
        class="input-vintage resize-y font-mono text-[13px] leading-relaxed"
        rows={8}
        spellcheck={false}
        placeholder="e.g. Prioritize anything about their SOC, cloud migration, CISO changes, or breaches…"
        value={value()}
        onInput={(e) => setValue(e.currentTarget.value)}
      />
      <Show when={msg()}>
        <div class="text-[12px] font-semibold text-surf-300">{msg()}</div>
      </Show>
      <div class="flex gap-2 justify-end flex-wrap">
        <button
          type="button"
          class="press press-ghost press-sm"
          disabled={saving() || !isCustom()}
          onClick={() => save(true)}
        >
          Use global
        </button>
        <Button variant="primary" size="sm" disabled={saving()} onClick={() => save(false)}>
          {saving() ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
