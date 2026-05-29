import { createResource, For, Show } from 'solid-js';
import { useParams } from '@solidjs/router';
import { api } from '../lib/api';
import BackLink from '../components/BackLink';

const MODE_LABEL: Record<string, string> = {
  in_person: 'In Person',
  virtual: 'Virtual',
  hybrid: 'Hybrid',
  on_demand: 'On Demand',
};

function modeChipClass(mode: string | null): string {
  switch (mode) {
    case 'in_person': return 'bg-surf-500/20 text-surf-200 border-surf-400';
    case 'hybrid': return 'bg-cerulean-500/20 text-cerulean-200 border-cerulean-400';
    case 'virtual': return 'bg-base-700 text-base-200 border-base-400';
    case 'on_demand': return 'bg-papaya-500/20 text-papaya-200 border-papaya-400';
    default: return 'bg-base-800 text-base-300 border-base-500';
  }
}

function formatLongDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y) return iso;
  const date = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function formatLocation(e: any): string {
  const parts = [e.city, e.state, e.country].filter(Boolean);
  if (parts.length) return parts.join(', ');
  return e.location_raw || '';
}

export default function EventDetail() {
  const params = useParams<{ id: string }>();
  const [event] = createResource(() => Number(params.id), (id) => api.getEvent(id));

  return (
    <div>
      <BackLink fallbackHref="/events" fallbackLabel="Events" />

      <Show when={event()} fallback={<div class="text-base-300 p-10 text-center">Loading...</div>}>
        {(e) => (
          <>
            <div class="flex flex-col gap-4 mb-6 md:flex-row md:justify-between md:items-start">
              <div class="flex-1 min-w-0">
                <h1 class="text-[26px] font-bold font-[family-name:var(--font-display)] leading-tight">{e().title}</h1>
                <div class="flex items-center gap-3 mt-2 flex-wrap text-base-300 text-[12px] uppercase tracking-wider">
                  <Show when={e().start_date}>
                    <span>
                      {formatLongDate(e().start_date)}
                      <Show when={e().end_date && e().end_date !== e().start_date}>
                        {' '}→ {formatLongDate(e().end_date)}
                      </Show>
                    </span>
                  </Show>
                  <Show when={e().mode}>
                    <span class={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest border ${modeChipClass(e().mode)}`}>
                      {MODE_LABEL[e().mode] || e().mode}
                    </span>
                  </Show>
                </div>
              </div>
              <Show when={e().url}>
                <a
                  href={e().url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="press press-primary press-md"
                >
                  {/^https?:\/\/register\./i.test(e().url) ? 'Register ↗' : 'View Event ↗'}
                </a>
              </Show>
            </div>

            {/* Details grid */}
            <div class="grid grid-cols-1 gap-4 md:grid-cols-2 mb-5">
              <Show when={formatLocation(e())}>
                <div class="panel p-4">
                  <h3 class="text-[10px] font-bold uppercase tracking-widest text-surf-300 mb-2">Location</h3>
                  <div class="text-base-50 text-sm">{formatLocation(e())}</div>
                  <Show when={e().venue}>
                    <div class="text-base-300 text-[12px] mt-1">{e().venue}</div>
                  </Show>
                  <Show when={e().location_raw && e().location_raw !== formatLocation(e())}>
                    <div class="text-base-400 text-[11px] mt-1 italic">{e().location_raw}</div>
                  </Show>
                </div>
              </Show>

              <Show when={e().tags?.length}>
                <div class="panel p-4">
                  <h3 class="text-[10px] font-bold uppercase tracking-widest text-surf-300 mb-2">Tags</h3>
                  <div class="flex flex-wrap gap-1.5">
                    <For each={e().tags}>
                      {(t: string) => (
                        <span class="text-[11px] uppercase tracking-wider text-base-200 border-2 border-base-500 px-2 py-0.5">{t}</span>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            </div>

            <Show when={e().summary}>
              <div class="panel panel-accent p-5 mb-5">
                <h3 class="text-[11px] font-bold uppercase tracking-widest text-surf-300 mb-3">Summary</h3>
                <div class="text-base-50 text-[13px] leading-relaxed whitespace-pre-wrap break-words">{e().summary}</div>
              </div>
            </Show>

            {/* Source / metadata footer */}
            <div class="panel p-4 text-[11px] text-base-300">
              <div class="flex flex-col gap-1 md:flex-row md:flex-wrap md:gap-x-6">
                <div><span class="uppercase tracking-wider text-base-400">Source:</span> {e().source}</div>
                <Show when={e().scraped_at}>
                  <div><span class="uppercase tracking-wider text-base-400">Scraped:</span> {new Date(e().scraped_at).toLocaleString()}</div>
                </Show>
                <Show when={e().first_seen_at}>
                  <div><span class="uppercase tracking-wider text-base-400">First seen:</span> {new Date(e().first_seen_at).toLocaleString()}</div>
                </Show>
              </div>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}
