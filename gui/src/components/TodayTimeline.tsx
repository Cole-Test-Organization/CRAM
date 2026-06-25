import { createSignal, createMemo, onMount, onCleanup, For, Show } from 'solid-js';
import { A, useNavigate } from '@solidjs/router';
import { localDateStr } from '../utils/date';

// A meeting as the Today timeline needs it. Loosely typed because the meetings
// list endpoint hands rows back as `any`; we only touch these fields.
type TimelineMeeting = {
  id: number;
  title?: string | null;
  filename?: string;
  account_name?: string | null;
  internal?: boolean;
  date: string;
  starts_at?: string | null;
  ends_at?: string | null;
  location?: string | null;
};

type Props = {
  meetings: () => TimelineMeeting[];
  getHref?: (m: TimelineMeeting) => string;
};

// Layout constants for the vertical day grid (à la Google Calendar's day view):
// vertical position encodes time of day.
const PX_PER_MIN = 1.2; // 72px per hour
const MIN_BLOCK_PX = 28; // keep short meetings tappable / legible
const GUTTER = 52; // left column reserved for hour labels
const MAX_VIEWPORT_PX = 460; // scroll past this height; we auto-scroll to "now"
const DEFAULT_DURATION_MIN = 30; // assumed length when a meeting has no end time

function minsSinceMidnight(d: Date): number {
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}
function fmtTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function fmtHourLabel(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  return d.toLocaleTimeString([], { hour: 'numeric' });
}

// A location that's a URL is a join link; anything else is plain text (a room).
function joinUrl(m: TimelineMeeting): string | null {
  const loc = (m.location || '').trim();
  return /^https?:\/\//i.test(loc) ? loc : null;
}
function locationLabel(m: TimelineMeeting): string | null {
  const loc = (m.location || '').trim();
  return loc && !/^https?:\/\//i.test(loc) ? loc : null;
}

// A "Join" link that opens the conferencing URL in a new tab. stopPropagation so
// clicking it inside a clickable meeting block doesn't also navigate to the
// meeting detail.
function JoinLink(props: { url: string; class?: string }) {
  return (
    <a
      href={props.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      class={`inline-flex items-center gap-1 border border-surf-300 text-surf-200 hover:bg-surf-300 hover:text-base-950 px-1.5 py-0.5 text-[10px] uppercase tracking-wider font-bold no-underline transition-colors ${props.class || ''}`}
    >
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="m23 7-7 5 7 5V7z" />
        <rect x="1" y="5" width="15" height="14" rx="2" />
      </svg>
      Join
    </a>
  );
}

type Positioned = {
  m: TimelineMeeting;
  start: Date;
  end: Date;
  assumedEnd: boolean; // end was inferred (no ends_at) — show start time only
  col: number; // column within its overlap cluster
  cols: number; // total columns in that cluster (for side-by-side width)
};

export default function TodayTimeline(props: Props) {
  const href = (m: TimelineMeeting) => (props.getHref ? props.getHref(m) : `/meetings/${m.id}`);
  const meetingTitle = (m: TimelineMeeting) => m.title || m.filename || 'Untitled';
  const navigate = useNavigate();

  // Tick once a minute so the now-line — and the "today" rollover at midnight —
  // track the machine clock. This clock is the whole point of the view.
  const [now, setNow] = createSignal(new Date());
  onMount(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    onCleanup(() => clearInterval(id));
  });

  const todayStr = createMemo(() => localDateStr(now()));
  const todays = createMemo(() => props.meetings().filter((m) => m.date === todayStr()));

  // Timed meetings, positioned. Greedy interval-partitioning per overlap cluster
  // packs double-booked meetings side by side while a normal day of back-to-back
  // meetings stays full width.
  const timed = createMemo<Positioned[]>(() => {
    const out: Positioned[] = [];
    for (const m of todays()) {
      if (!m.starts_at) continue;
      const start = new Date(m.starts_at);
      if (Number.isNaN(start.getTime())) continue;
      let end = m.ends_at ? new Date(m.ends_at) : null;
      const assumedEnd = !end || Number.isNaN(end.getTime()) || end <= start;
      if (assumedEnd) end = new Date(start.getTime() + DEFAULT_DURATION_MIN * 60_000);
      out.push({ m, start, end: end as Date, assumedEnd, col: 0, cols: 1 });
    }
    out.sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime());

    let cluster: Positioned[] = [];
    let clusterEnd = -Infinity;
    const flush = () => {
      const colEnds: number[] = [];
      for (const it of cluster) {
        let c = colEnds.findIndex((e) => e <= it.start.getTime());
        if (c === -1) {
          c = colEnds.length;
          colEnds.push(it.end.getTime());
        } else {
          colEnds[c] = it.end.getTime();
        }
        it.col = c;
      }
      for (const it of cluster) it.cols = colEnds.length;
      cluster = [];
    };
    for (const it of out) {
      if (cluster.length && it.start.getTime() >= clusterEnd) flush();
      cluster.push(it);
      clusterEnd = Math.max(clusterEnd, it.end.getTime());
    }
    if (cluster.length) flush();
    return out;
  });

  const untimed = createMemo(() => todays().filter((m) => !m.starts_at));

  // The vertical window: earliest start → latest end, padded to whole hours and
  // always including "now" so the indicator is on-screen.
  const windowRange = createMemo(() => {
    const mins: number[] = [minsSinceMidnight(now())];
    for (const t of timed()) {
      mins.push(minsSinceMidnight(t.start));
      mins.push(minsSinceMidnight(t.end));
    }
    const lo = Math.floor(Math.min(...mins) / 60) * 60;
    let hi = Math.ceil(Math.max(...mins) / 60) * 60;
    if (hi - lo < 120) hi = lo + 120; // show at least a 2-hour band
    return { lo, hi };
  });

  const hours = createMemo(() => {
    const { lo, hi } = windowRange();
    const arr: number[] = [];
    for (let h = lo; h <= hi; h += 60) arr.push(h);
    return arr;
  });
  const gridHeight = createMemo(() => {
    const { lo, hi } = windowRange();
    return (hi - lo) * PX_PER_MIN;
  });
  const topOf = (mins: number) => (mins - windowRange().lo) * PX_PER_MIN;
  const nowTopPx = createMemo(() => topOf(minsSinceMidnight(now())));
  const nowInWindow = createMemo(() => {
    const { lo, hi } = windowRange();
    const nm = minsSinceMidnight(now());
    return nm >= lo && nm <= hi;
  });

  // The meeting happening right now (start ≤ now < end), and the next one up.
  const current = createMemo(() => {
    const t = now().getTime();
    return timed().find((x) => x.start.getTime() <= t && t < x.end.getTime()) || null;
  });
  const nextUp = createMemo(() => {
    const t = now().getTime();
    return timed().filter((x) => x.start.getTime() > t)[0] || null; // timed() is start-sorted
  });

  let scrollRef: HTMLDivElement | undefined;
  onMount(() => {
    // Center the now-line in the viewport on first paint.
    if (scrollRef) scrollRef.scrollTop = Math.max(0, nowTopPx() - MAX_VIEWPORT_PX / 3);
  });

  return (
    <Show when={todays().length > 0}>
      <div class="mb-6">
        {/* header: Today · date · live status */}
        <div class="flex items-center gap-3 mb-3 flex-wrap">
          <h2 class="text-[15px] font-bold uppercase tracking-wider text-base-200 font-[family-name:var(--font-display)]">
            Today
          </h2>
          <span class="text-base-400 text-[12px]">
            {now().toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
          </span>
          <div class="md:ml-auto">
            <Show
              when={current()}
              fallback={
                <Show when={nextUp()}>
                  {(n) => (
                    <span class="inline-flex items-center gap-1.5 text-[12px] text-base-300">
                      <span>Next · <span class="text-surf-300 font-semibold">{fmtTime(n().start)}</span> {meetingTitle(n().m)}</span>
                      <Show when={joinUrl(n().m)}>{(u) => <JoinLink url={u()} />}</Show>
                    </span>
                  )}
                </Show>
              }
            >
              {(c) => (
                <span class="inline-flex items-center gap-1.5 text-[12px] text-scarlet-300 font-semibold">
                  <span class="w-1.5 h-1.5 bg-scarlet-400 inline-block" /> Now · {meetingTitle(c().m)}
                  <Show when={joinUrl(c().m)}>{(u) => <JoinLink url={u()} />}</Show>
                </span>
              )}
            </Show>
          </div>
        </div>

        {/* timed grid */}
        <Show when={timed().length > 0}>
          <div
            ref={scrollRef}
            class="border-2 border-base-500 bg-base-950 overflow-y-auto"
            style={{ 'max-height': `${MAX_VIEWPORT_PX}px` }}
          >
            <div class="relative" style={{ height: `${gridHeight()}px` }}>
              {/* hour gridlines + labels */}
              <For each={hours()}>
                {(h) => (
                  <div class="absolute left-0 right-0 border-t border-base-700" style={{ top: `${topOf(h)}px` }}>
                    <span class="absolute left-2 top-1 text-[10px] uppercase tracking-wider text-base-400 bg-base-950 pr-1">
                      {fmtHourLabel(h)}
                    </span>
                  </div>
                )}
              </For>

              {/* meeting blocks (lane offset past the hour-label gutter) */}
              <div class="absolute top-0 bottom-0 right-2" style={{ left: `${GUTTER}px` }}>
                <For each={timed()}>
                  {(b) => {
                    const isNow = () => current()?.m.id === b.m.id;
                    const heightPx = Math.max(
                      MIN_BLOCK_PX,
                      ((b.end.getTime() - b.start.getTime()) / 60_000) * PX_PER_MIN,
                    );
                    return (
                      <div
                        role="link"
                        tabindex="0"
                        onClick={() => navigate(href(b.m))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            navigate(href(b.m));
                          }
                        }}
                        class={`absolute block overflow-hidden border-2 px-2 py-1 cursor-pointer transition-colors ${
                          isNow() ? 'border-scarlet-400 bg-base-800' : 'border-base-500 bg-base-900 hover:bg-base-800'
                        }`}
                        style={{
                          top: `${topOf(minsSinceMidnight(b.start))}px`,
                          height: `${heightPx}px`,
                          left: `calc(${(b.col / b.cols) * 100}% + ${b.col ? 2 : 0}px)`,
                          width: `calc(${100 / b.cols}% - 4px)`,
                          'z-index': isNow() ? 10 : 1,
                        }}
                      >
                        <Show when={joinUrl(b.m)}>
                          {(u) => <JoinLink url={u()} class="absolute top-1 right-1 z-10" />}
                        </Show>
                        <div class={`flex items-center gap-1.5 min-w-0 ${joinUrl(b.m) ? 'pr-14' : ''}`}>
                          <Show when={isNow()}>
                            <span class="shrink-0 w-1.5 h-1.5 bg-scarlet-400 inline-block" />
                          </Show>
                          <span class={`truncate text-[12px] font-semibold ${isNow() ? 'text-base-50' : 'text-base-100'}`}>
                            {meetingTitle(b.m)}
                          </span>
                        </div>
                        <div class="truncate text-[10px] text-base-400">
                          {fmtTime(b.start)}
                          {b.assumedEnd ? '' : `–${fmtTime(b.end)}`}
                          <Show when={!b.m.internal && b.m.account_name}>{` · ${b.m.account_name}`}</Show>
                          <Show when={b.m.internal}>{' · Internal'}</Show>
                          <Show when={locationLabel(b.m)}>{(loc) => ` · ${loc()}`}</Show>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </div>

              {/* the live "now" line — drawn over the blocks, clicks pass through */}
              <Show when={nowInWindow()}>
                <div class="absolute left-0 right-2 z-20 pointer-events-none" style={{ top: `${nowTopPx()}px` }}>
                  <span class="absolute left-2 -top-2 text-[10px] font-bold text-scarlet-300 bg-base-950 pr-1">
                    {fmtTime(now())}
                  </span>
                  <span class="absolute -top-[3px] h-2 w-2 bg-scarlet-400" style={{ left: `${GUTTER - 4}px` }} />
                  <div class="h-[2px] bg-scarlet-400" style={{ 'margin-left': `${GUTTER}px` }} />
                </div>
              </Show>
            </div>
          </div>
        </Show>

        {/* untimed today meetings (notes-import / no time of day) */}
        <Show when={untimed().length > 0}>
          <div class={`flex flex-wrap gap-2 ${timed().length > 0 ? 'mt-3' : ''}`}>
            <Show when={timed().length === 0}>
              <span class="text-[12px] text-base-400 w-full">No timed meetings today.</span>
            </Show>
            <For each={untimed()}>
              {(m) => (
                <A
                  href={href(m)}
                  class="inline-flex items-center gap-2 border-2 border-base-500 bg-base-900 hover:bg-base-800 px-2 py-1 text-[12px] text-base-100 no-underline transition-colors"
                >
                  <Show when={m.internal}>
                    <span class="text-surf-300 text-[10px] uppercase tracking-wider">Internal</span>
                  </Show>
                  <span class="font-semibold truncate max-w-[200px]">{meetingTitle(m)}</span>
                  <Show when={!m.internal && m.account_name}>
                    <span class="text-base-400">{m.account_name}</span>
                  </Show>
                </A>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
}
