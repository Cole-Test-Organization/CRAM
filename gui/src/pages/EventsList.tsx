import { createResource, createSignal, createMemo, For, Show } from 'solid-js';
import { A } from '@solidjs/router';
import { api } from '../lib/api';
import { debounce } from '../lib/editing';
import Button from '../components/Button';

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

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y) return iso;
  const date = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  const month = date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return `${month} ${d || 1}, ${y}`;
}

function formatLocation(e: any): string {
  const parts = [e.city, e.state, e.country].filter(Boolean);
  if (parts.length) return parts.join(', ');
  return e.location_raw || '';
}

function truncate(s: string | null, max = 200): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max).trimEnd() + '…';
}

export default function EventsList() {
  const [view, setView] = createSignal<'all' | 'with_contacts'>('all');

  // Filter state
  const [searchInput, setSearchInput] = createSignal('');
  const [search, setSearch] = createSignal('');
  const debouncedSetSearch = debounce((v: string) => setSearch(v), 300);

  const [mode, setMode] = createSignal('');
  const [city, setCity] = createSignal('');
  const [country, setCountry] = createSignal('');
  const [tag, setTag] = createSignal('');
  const [hasLocation, setHasLocation] = createSignal(false);
  const [after, setAfter] = createSignal(todayISO());
  const [before, setBefore] = createSignal('');
  const [sort, setSort] = createSignal('start_date');
  const [order, setOrder] = createSignal<'asc' | 'desc'>('asc');

  const [facets] = createResource(() => api.getEventFacets());

  const filterParams = createMemo(() => ({
    view: view(),
    search: search(),
    mode: mode(),
    city: city(),
    country: country(),
    tags: tag(),
    has_location: hasLocation(),
    after: after(),
    before: before(),
    sort: sort(),
    order: order(),
  }));

  const [data] = createResource(filterParams, async (params) => {
    if (params.view === 'with_contacts') {
      const { events } = await api.getUpcomingEventsWithContacts({
        mode: params.mode || 'in_person',
        after: params.after || undefined,
        before: params.before || undefined,
        limit: 100,
      });
      return { events, total: events.length };
    }
    return api.getEvents({
      search: params.search || undefined,
      mode: params.mode || undefined,
      city: params.city || undefined,
      country: params.country || undefined,
      tags: params.tags || undefined,
      has_location: params.has_location || undefined,
      after: params.after || undefined,
      before: params.before || undefined,
      sort: params.sort,
      order: params.order,
      limit: 200,
    });
  });

  const events = () => data()?.events || [];
  const total = () => data()?.total || 0;

  const clearFilters = () => {
    setSearchInput('');
    setSearch('');
    debouncedSetSearch.cancel();
    setMode('');
    setCity('');
    setCountry('');
    setTag('');
    setHasLocation(false);
    setAfter(todayISO());
    setBefore('');
    setSort('start_date');
    setOrder('asc');
  };

  const activeFilterCount = () => {
    let n = 0;
    if (search()) n++;
    if (mode()) n++;
    if (city()) n++;
    if (country()) n++;
    if (tag()) n++;
    if (hasLocation()) n++;
    if (after() && after() !== todayISO()) n++;
    if (before()) n++;
    return n;
  };

  return (
    <div>
      <div class="flex flex-col gap-3 mb-6 md:flex-row md:justify-between md:items-center">
        <h1 class="text-[26px] font-bold font-[family-name:var(--font-display)]">Events</h1>
        <div class="flex items-center gap-4 flex-wrap">
          <span class="text-base-300 text-[12px] uppercase tracking-wider">{total()} events</span>
        </div>
      </div>

      {/* View toggle */}
      <div class="flex gap-2 mb-5 flex-wrap">
        <button
          type="button"
          class={`press press-sm ${view() === 'all' ? 'press-primary' : 'press-ghost'}`}
          onClick={() => setView('all')}
        >
          All Events
        </button>
        <button
          type="button"
          class={`press press-sm ${view() === 'with_contacts' ? 'press-primary' : 'press-ghost'}`}
          onClick={() => setView('with_contacts')}
        >
          Travel Planner
        </button>
        <Show when={view() === 'with_contacts'}>
          <span class="text-base-300 text-[11px] uppercase tracking-wider self-center ml-1">
            Upcoming events near my contacts
          </span>
        </Show>
      </div>

      {/* Filters */}
      <div class="panel p-4 mb-5">
        {/* Search row */}
        <Show when={view() === 'all'}>
          <div class="flex items-center bg-base-950 border-2 border-base-500 px-3 py-2 gap-2 mb-3 focus-within:border-surf-300 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-surf-400"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input
              type="text"
              placeholder="Search title, summary, location..."
              value={searchInput()}
              onInput={(e) => {
                setSearchInput(e.currentTarget.value);
                debouncedSetSearch(e.currentTarget.value);
              }}
              class="flex-1 bg-transparent border-none outline-none text-base-50 text-sm placeholder:text-base-400"
            />
            <Show when={searchInput()}>
              <button
                type="button"
                class="btn-x"
                onClick={() => { setSearchInput(''); setSearch(''); debouncedSetSearch.cancel(); }}
                aria-label="Clear search"
              >×</button>
            </Show>
          </div>
        </Show>

        {/* Filter selects — grid on desktop, stacked on mobile */}
        <div class="grid grid-cols-1 gap-3 md:grid-cols-4">
          <label class="flex flex-col gap-1">
            <span class="text-[10px] uppercase tracking-widest text-surf-300 font-bold">Mode</span>
            <select class="input-vintage cursor-pointer" value={mode()} onChange={(e) => setMode(e.currentTarget.value)}>
              <option value="">All modes</option>
              <For each={facets()?.modes || []}>
                {(m) => <option value={m.value}>{MODE_LABEL[m.value] || m.value} ({m.count})</option>}
              </For>
            </select>
          </label>

          <Show when={view() === 'all'}>
            <label class="flex flex-col gap-1">
              <span class="text-[10px] uppercase tracking-widest text-surf-300 font-bold">City</span>
              <select class="input-vintage cursor-pointer" value={city()} onChange={(e) => setCity(e.currentTarget.value)}>
                <option value="">All cities</option>
                <For each={facets()?.cities || []}>
                  {(c) => <option value={c.value}>{c.value} ({c.count})</option>}
                </For>
              </select>
            </label>

            <label class="flex flex-col gap-1">
              <span class="text-[10px] uppercase tracking-widest text-surf-300 font-bold">Country</span>
              <select class="input-vintage cursor-pointer" value={country()} onChange={(e) => setCountry(e.currentTarget.value)}>
                <option value="">All countries</option>
                <For each={facets()?.countries || []}>
                  {(c) => <option value={c.value}>{c.value} ({c.count})</option>}
                </For>
              </select>
            </label>

            <label class="flex flex-col gap-1">
              <span class="text-[10px] uppercase tracking-widest text-surf-300 font-bold">Tag</span>
              <select class="input-vintage cursor-pointer" value={tag()} onChange={(e) => setTag(e.currentTarget.value)}>
                <option value="">All tags</option>
                <For each={facets()?.tags || []}>
                  {(t) => <option value={t.value}>{t.value} ({t.count})</option>}
                </For>
              </select>
            </label>
          </Show>
        </div>

        {/* Date range + toggles + sort */}
        <div class="grid grid-cols-1 gap-3 md:grid-cols-4 mt-3">
          <label class="flex flex-col gap-1">
            <span class="text-[10px] uppercase tracking-widest text-surf-300 font-bold">After</span>
            <input
              type="date"
              class="input-vintage"
              value={after()}
              onInput={(e) => setAfter(e.currentTarget.value)}
            />
          </label>

          <label class="flex flex-col gap-1">
            <span class="text-[10px] uppercase tracking-widest text-surf-300 font-bold">Before</span>
            <input
              type="date"
              class="input-vintage"
              value={before()}
              onInput={(e) => setBefore(e.currentTarget.value)}
            />
          </label>

          <Show when={view() === 'all'}>
            <label class="flex flex-col gap-1">
              <span class="text-[10px] uppercase tracking-widest text-surf-300 font-bold">Sort</span>
              <select class="input-vintage cursor-pointer" value={sort()} onChange={(e) => setSort(e.currentTarget.value)}>
                <option value="start_date">Start date</option>
                <option value="end_date">End date</option>
                <option value="title">Title</option>
                <option value="created_at">Created</option>
                <option value="updated_at">Updated</option>
              </select>
            </label>

            <label class="flex flex-col gap-1">
              <span class="text-[10px] uppercase tracking-widest text-surf-300 font-bold">Order</span>
              <select class="input-vintage cursor-pointer" value={order()} onChange={(e) => setOrder(e.currentTarget.value as 'asc' | 'desc')}>
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            </label>
          </Show>
        </div>

        <div class="flex items-center gap-4 mt-4 flex-wrap">
          <Show when={view() === 'all'}>
            <label class="flex items-center gap-2 text-[12px] text-base-200 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hasLocation()}
                onChange={(e) => setHasLocation(e.currentTarget.checked)}
                class="w-4 h-4 cursor-pointer"
              />
              <span>Only events with a location</span>
            </label>
          </Show>

          <Show when={activeFilterCount() > 0}>
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear filters ({activeFilterCount()})
            </Button>
          </Show>
        </div>
      </div>

      {/* Results */}
      <Show when={!data.loading} fallback={<div class="text-base-300 p-10 text-center">Loading...</div>}>
        <div class="panel panel-accent">
          <For
            each={events()}
            fallback={
              <div class="text-base-300 text-center p-10 text-sm">
                <Show when={view() === 'with_contacts'} fallback={<>No events match these filters. Try clearing tags or expanding the date range.</>}>
                  No upcoming events have contacts in their city. Try a wider date range.
                </Show>
              </div>
            }
          >
            {(e: any) => (
              <div class="flex items-stretch gap-2 border-b border-base-700 last:border-b-0 hover:bg-base-700 transition-colors duration-150">
                <A
                  href={`/events/${e.id}`}
                  class="flex-1 min-w-0 press-row !block py-3"
                >
                  <div class="flex flex-col gap-2 md:flex-row md:gap-4 md:items-start">
                    {/* Date — on mobile, sits as a line above; on desktop, left column */}
                    <div class="flex flex-row md:flex-col md:min-w-[120px] gap-2 md:gap-0 items-baseline md:items-start">
                      <span class="text-surf-300 text-[12px] font-bold uppercase tracking-wider whitespace-nowrap">
                        {e.start_date ? formatShortDate(e.start_date) : 'TBD'}
                      </span>
                      <Show when={e.end_date && e.end_date !== e.start_date}>
                        <span class="text-base-400 text-[10px] uppercase tracking-wider whitespace-nowrap">
                          → {formatShortDate(e.end_date)}
                        </span>
                      </Show>
                    </div>

                    {/* Title + meta column */}
                    <div class="flex-1 min-w-0 flex flex-col gap-1">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="font-semibold text-sm text-base-50">{e.title}</span>
                        <Show when={e.mode}>
                          <span class={`inline-block px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest border ${modeChipClass(e.mode)}`}>
                            {MODE_LABEL[e.mode] || e.mode}
                          </span>
                        </Show>
                      </div>
                      <Show when={formatLocation(e)}>
                        <span class="text-base-300 text-[12px]">{formatLocation(e)}</span>
                      </Show>
                      <Show when={e.summary}>
                        <span class="text-base-400 text-[12px] leading-snug">{truncate(e.summary, 200)}</span>
                      </Show>
                      <Show when={e.tags?.length}>
                        <div class="flex flex-wrap gap-1 mt-0.5">
                          <For each={e.tags}>
                            {(t: string) => (
                              <span class="text-[10px] uppercase tracking-wider text-base-300 border border-base-600 px-1.5 py-0.5">{t}</span>
                            )}
                          </For>
                        </div>
                      </Show>
                      <Show when={e.matched_contacts?.length}>
                        <div class="mt-1 flex flex-wrap gap-1.5 items-center">
                          <span class="text-[10px] uppercase tracking-widest text-surf-300 font-bold">
                            {e.matched_contacts.length} contact{e.matched_contacts.length === 1 ? '' : 's'} nearby:
                          </span>
                          <For each={e.matched_contacts.slice(0, 5)}>
                            {(c: any) => (
                              <span class="text-[11px] bg-surf-500/15 border border-surf-500/50 text-surf-200 px-1.5 py-0.5">
                                {c.full_name}{c.company ? ` · ${c.company}` : ''}
                              </span>
                            )}
                          </For>
                          <Show when={e.matched_contacts.length > 5}>
                            <span class="text-[11px] text-base-300">+{e.matched_contacts.length - 5} more</span>
                          </Show>
                        </div>
                      </Show>
                    </div>
                  </div>
                </A>
                <Show when={e.url}>
                  <a
                    href={e.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(ev) => ev.stopPropagation()}
                    class="self-center shrink-0 px-3 py-2 mr-2 md:mr-3 border-2 border-surf-500/60 text-surf-200 hover:bg-surf-500/15 hover:border-surf-300 transition-colors text-[11px] font-bold uppercase tracking-widest"
                    title={e.url}
                  >
                    {/^https?:\/\/register\./i.test(e.url) ? 'Register ↗' : 'View ↗'}
                  </a>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
