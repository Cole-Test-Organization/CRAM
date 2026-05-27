import { createResource, createSignal, For, Show } from 'solid-js';
import { A } from '@solidjs/router';
import { api } from '../lib/api';
import { debounce } from '../lib/editing';
import PressCard from '../components/dashboard/PressCard';
import Button from '../components/Button';

export default function Dashboard() {
  const [health] = createResource(() => api.health());
  const [recentMeetings] = createResource(() => api.getAllMeetings({ limit: 15 }));
  const [accounts] = createResource(() => api.getAccounts({ exclude_status: 'partner', sort: 'last_contact', limit: 10 }));
  const [partners] = createResource(() => api.getAccounts({ status: 'partner', sort: 'name', limit: 10 }));

  const [query, setQuery] = createSignal('');
  const [searchResults] = createResource(
    query,
    (q) => (q && q.length >= 2) ? api.search(q, 'all', 20) : null
  );
  const debouncedSetQuery = debounce((q: string) => setQuery(q), 300);

  return (
    <div>
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-[26px] font-bold font-[family-name:var(--font-display)]">Dashboard</h1>
      </div>

      {/* Search */}
      <div class="relative mb-7">
        <div class="flex items-center bg-base-950 border-2 border-base-500 px-3 py-2 gap-2 focus-within:border-surf-300 transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-surf-400"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input
            type="text"
            placeholder="Search accounts, contacts, meetings..."
            onInput={(e) => debouncedSetQuery(e.currentTarget.value)}
            class="flex-1 bg-transparent border-none outline-none text-base-50 text-sm placeholder:text-base-400"
          />
        </div>

        <Show when={query().length >= 2 && searchResults()}>
          {(r) => (
            <div class="panel mt-2 max-h-[60vh] md:max-h-[600px] overflow-y-auto absolute left-0 right-0 z-50">
              <Show when={r().total === 0}>
                <div class="text-base-300 text-center p-5 text-sm">No results for "{r().query}"</div>
              </Show>

              <Show when={r().results.accounts?.length}>
                <div class="border-b-2 border-base-600 last:border-b-0">
                  <div class="text-[11px] uppercase text-surf-300 tracking-wider px-4 pt-2.5 pb-1 font-bold">Accounts</div>
                  <For each={r().results.accounts!}>
                    {(acct) => (
                      <A href={`/accounts/${acct.slug}`} class="press-row">
                        <div class="flex-1">
                          <div class="font-semibold text-sm text-base-50">{acct.name}</div>
                          <div class="sr-snippet text-[12px] text-base-300 leading-normal mt-0.5" innerHTML={acct.snippet} />
                        </div>
                      </A>
                    )}
                  </For>
                </div>
              </Show>

              <Show when={r().results.contacts?.length}>
                <div class="border-b-2 border-base-600 last:border-b-0">
                  <div class="text-[11px] uppercase text-surf-300 tracking-wider px-4 pt-2.5 pb-1 font-bold">Contacts</div>
                  <For each={r().results.contacts!}>
                    {(c) => (
                      <A href={`/contacts/${c.id}`} class="press-row">
                        <div class="flex-1">
                          <div class="font-semibold text-sm text-base-50">{c.full_name}{c.title ? ` — ${c.title}` : ''}</div>
                          <div class="sr-snippet text-[12px] text-base-300 leading-normal mt-0.5" innerHTML={c.snippet} />
                        </div>
                      </A>
                    )}
                  </For>
                </div>
              </Show>

              <Show when={r().results.meetings?.length}>
                <div class="border-b-2 border-base-600 last:border-b-0">
                  <div class="text-[11px] uppercase text-surf-300 tracking-wider px-4 pt-2.5 pb-1 font-bold">Meetings</div>
                  <For each={r().results.meetings!}>
                    {(m) => (
                      <A href={`/meetings/${m.id}`} class="press-row">
                        <div class="flex-1">
                          <div class="font-semibold text-sm text-base-50 flex items-center gap-2 flex-wrap">
                            <Show when={m.internal}>
                              <span class="bg-base-950 border border-surf-300 text-surf-300 text-[10px] px-1.5 py-0.5 uppercase tracking-widest font-bold leading-none">Internal</span>
                            </Show>
                            <span>{m.title || m.filename} <span class="text-base-300 text-[12px] font-normal">— {m.internal ? 'Internal' : m.account_name} — {m.date}</span></span>
                          </div>
                          <div class="sr-snippet text-[12px] text-base-300 leading-normal mt-0.5" innerHTML={m.snippet} />
                        </div>
                      </A>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          )}
        </Show>
      </div>

      {/* Stats — clickable */}
      <Show when={health()}>
        <div class="grid grid-cols-2 gap-4 mb-6 md:grid-cols-4 md:gap-5 md:mb-8">
          <PressCard href="/accounts" accent class="text-center">
            <div class="text-[32px] font-bold text-surf-300 font-[family-name:var(--font-display)] leading-none">{health()!.counts.accounts}</div>
            <div class="text-[11px] text-base-200 mt-2 uppercase tracking-widest font-semibold">Accounts</div>
          </PressCard>
          <PressCard href="/opportunities" accent class="text-center">
            <div class="text-[32px] font-bold text-surf-300 font-[family-name:var(--font-display)] leading-none">{health()!.counts.opportunities ?? 0}</div>
            <div class="text-[11px] text-base-200 mt-2 uppercase tracking-widest font-semibold">Opportunities</div>
          </PressCard>
          <PressCard href="/contacts" accent class="text-center">
            <div class="text-[32px] font-bold text-surf-300 font-[family-name:var(--font-display)] leading-none">{health()!.counts.contacts}</div>
            <div class="text-[11px] text-base-200 mt-2 uppercase tracking-widest font-semibold">Contacts</div>
          </PressCard>
          <PressCard href="/meetings" accent class="text-center">
            <div class="text-[32px] font-bold text-surf-300 font-[family-name:var(--font-display)] leading-none">{health()!.counts.meetings}</div>
            <div class="text-[11px] text-base-200 mt-2 uppercase tracking-widest font-semibold">Meetings</div>
          </PressCard>
        </div>
      </Show>

      {/* Recent Meetings */}
      <div class="mt-8">
        <div class="flex flex-col gap-2 mb-3 md:flex-row md:justify-between md:items-center">
          <h2 class="text-xs font-bold uppercase tracking-widest text-surf-300">Recent Meetings</h2>
          <Button href="/meetings" variant="ghost" size="sm">View all</Button>
        </div>
        <div class="panel panel-accent">
          <Show when={recentMeetings()} fallback={<div class="text-base-300 p-10 text-center">Loading...</div>}>
            <For each={recentMeetings()} fallback={<div class="text-base-300 text-center p-10 text-sm">No meetings yet</div>}>
              {(m: any) => (
                <A href={`/meetings/${m.id}`} class="press-row gap-4 flex-wrap border-b border-base-700 last:border-b-0">
                  <span class="flex-1 min-w-full md:min-w-0 font-semibold text-sm text-base-50 flex items-center gap-2 flex-wrap">
                    <Show when={m.internal}>
                      <span class="bg-base-950 border-2 border-surf-300 text-surf-300 text-[10px] px-1.5 py-0.5 uppercase tracking-widest font-bold leading-none">Internal</span>
                    </Show>
                    <span>{m.title || m.filename}</span>
                  </span>
                  <span class="text-base-300 text-[12px]">{m.internal ? '' : m.account_name}</span>
                  <span class="text-base-300 text-[12px]">{m.date}</span>
                </A>
              )}
            </For>
          </Show>
        </div>
      </div>

      {/* Recent Accounts */}
      <div class="mt-8">
        <div class="flex flex-col gap-2 mb-3 md:flex-row md:justify-between md:items-center">
          <h2 class="text-xs font-bold uppercase tracking-widest text-surf-300">Accounts</h2>
          <Button href="/accounts" variant="ghost" size="sm">View all</Button>
        </div>
        <div class="panel panel-accent">
          <Show when={accounts()} fallback={<div class="text-base-300 p-10 text-center">Loading...</div>}>
            <For each={accounts()!.accounts} fallback={<div class="text-base-300 text-center p-10 text-sm">No accounts yet</div>}>
              {(acct) => (
                <A href={`/accounts/${acct.slug}`} class="press-row gap-4 flex-wrap border-b border-base-700 last:border-b-0">
                  <span class="flex-1 min-w-[60%] md:min-w-0 font-semibold text-sm text-base-50">{acct.name}</span>
                  <span class="text-base-300 text-[12px]">{acct.last_contact || '—'}</span>
                </A>
              )}
            </For>
          </Show>
        </div>
      </div>

      {/* Partners */}
      <div class="mt-8">
        <div class="flex flex-col gap-2 mb-3 md:flex-row md:justify-between md:items-center">
          <h2 class="text-xs font-bold uppercase tracking-widest text-surf-300">Partners</h2>
          <Button href="/partners" variant="ghost" size="sm">View all</Button>
        </div>
        <div class="panel panel-accent">
          <Show when={partners()} fallback={<div class="text-base-300 p-10 text-center">Loading...</div>}>
            <For each={partners()!.accounts} fallback={<div class="text-base-300 text-center p-10 text-sm">No partners yet</div>}>
              {(acct) => (
                <A href={`/accounts/${acct.slug}`} class="press-row gap-4 flex-wrap border-b border-base-700 last:border-b-0">
                  <span class="flex-1 min-w-[60%] md:min-w-0 font-semibold text-sm text-base-50">{acct.name}</span>
                  <span class="text-base-300 text-[12px]">{acct.last_contact || '—'}</span>
                </A>
              )}
            </For>
          </Show>
        </div>
      </div>
    </div>
  );
}
