import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const MEETING_SCHEDULE_VERSION = 1;
export const SCHEDULE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
export const DEFAULT_MEETING_DURATION_MS = 60 * 60 * 1000;
export const MEETING_END_GRACE_MS = 2 * 60 * 1000;
const RETAIN_PAST_MS = 24 * 60 * 60 * 1000;
const RETAIN_FUTURE_MS = 45 * 24 * 60 * 60 * 1000;
const RETAIN_NOTIFICATION_MS = 48 * 60 * 60 * 1000;
const MINIMUM_TIMER_DELAY_MS = 1000;

function finiteInstant(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function meetingOccurrenceKey(meeting) {
  return `${meeting.id}:${meeting.starts_at}`;
}

export function normalizeMeetingSchedule(input, nowMs = Date.now()) {
  if (!Array.isArray(input)) return [];

  const earliest = nowMs - RETAIN_PAST_MS;
  const latest = nowMs + RETAIN_FUTURE_MS;
  const meetings = [];

  for (const value of input) {
    const id = Number(value?.id);
    const startsAtMs = finiteInstant(value?.starts_at);
    if (!Number.isInteger(id) || id <= 0 || startsAtMs === null) continue;
    if (startsAtMs < earliest || startsAtMs > latest) continue;

    const endsAtMs = finiteInstant(value?.ends_at);
    meetings.push({
      id,
      starts_at: new Date(startsAtMs).toISOString(),
      ends_at: endsAtMs !== null && endsAtMs > startsAtMs
        ? new Date(endsAtMs).toISOString()
        : null,
      title: typeof value?.title === 'string' ? value.title.slice(0, 300) : null,
      filename: typeof value?.filename === 'string' ? value.filename.slice(0, 300) : null,
      account_name: typeof value?.account_name === 'string'
        ? value.account_name.slice(0, 300)
        : null,
      internal: value?.internal === true,
    });
  }

  meetings.sort((left, right) =>
    Date.parse(left.starts_at) - Date.parse(right.starts_at) || left.id - right.id);
  return meetings;
}

export function meetingActiveUntil(meeting) {
  const startsAtMs = finiteInstant(meeting?.starts_at);
  if (startsAtMs === null) return null;
  const endsAtMs = finiteInstant(meeting?.ends_at);
  return endsAtMs !== null && endsAtMs > startsAtMs
    ? endsAtMs
    : startsAtMs + DEFAULT_MEETING_DURATION_MS;
}

export function findDueMeetings(meetings, notifiedOccurrences, nowMs = Date.now()) {
  const notified = notifiedOccurrences instanceof Set
    ? notifiedOccurrences
    : new Set(Object.keys(notifiedOccurrences || {}));

  return normalizeMeetingSchedule(meetings, nowMs).filter((meeting) => {
    const startsAtMs = Date.parse(meeting.starts_at);
    const activeUntilMs = meetingActiveUntil(meeting);
    return startsAtMs <= nowMs
      && activeUntilMs !== null
      && nowMs <= activeUntilMs + MEETING_END_GRACE_MS
      && !notified.has(meetingOccurrenceKey(meeting));
  });
}

export function nextSchedulerDelay(
  meetings,
  nowMs,
  lastRefreshAttemptMs,
  refreshIntervalMs = SCHEDULE_REFRESH_INTERVAL_MS,
) {
  const nextStartMs = normalizeMeetingSchedule(meetings, nowMs)
    .map((meeting) => Date.parse(meeting.starts_at))
    .find((startsAtMs) => startsAtMs > nowMs);
  const refreshAtMs = Math.max(nowMs, lastRefreshAttemptMs + refreshIntervalMs);
  const wakeAtMs = nextStartMs === undefined
    ? refreshAtMs
    : Math.min(nextStartMs, refreshAtMs);
  return Math.max(MINIMUM_TIMER_DELAY_MS, wakeAtMs - nowMs);
}

function emptyState() {
  return {
    version: MEETING_SCHEDULE_VERSION,
    updatedAt: null,
    meetings: [],
    notifiedOccurrences: {},
  };
}

export async function readMeetingScheduleState(statePath) {
  try {
    const raw = await readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.version !== MEETING_SCHEDULE_VERSION) return emptyState();
    return {
      version: MEETING_SCHEDULE_VERSION,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
      meetings: normalizeMeetingSchedule(parsed.meetings),
      notifiedOccurrences: parsed.notifiedOccurrences
        && typeof parsed.notifiedOccurrences === 'object'
        && !Array.isArray(parsed.notifiedOccurrences)
        ? parsed.notifiedOccurrences
        : {},
    };
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return emptyState();
    throw error;
  }
}

export async function writeMeetingScheduleState(statePath, state) {
  await mkdir(path.dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporaryPath, statePath);
}

function pruneNotifications(notifiedOccurrences, nowMs) {
  return Object.fromEntries(Object.entries(notifiedOccurrences || {}).filter(([, notifiedAt]) => {
    const notifiedAtMs = Date.parse(String(notifiedAt));
    return Number.isFinite(notifiedAtMs) && notifiedAtMs >= nowMs - RETAIN_NOTIFICATION_MS;
  }));
}

export function createMeetingScheduler({
  statePath,
  fetchMeetings,
  onMeetingStart,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  refreshIntervalMs = SCHEDULE_REFRESH_INTERVAL_MS,
  onError = () => {},
}) {
  if (!statePath) throw new Error('statePath is required.');
  if (typeof fetchMeetings !== 'function') throw new Error('fetchMeetings is required.');
  if (typeof onMeetingStart !== 'function') throw new Error('onMeetingStart is required.');

  let state = emptyState();
  let timer = null;
  let stopped = true;
  let lastRefreshAttemptMs = 0;
  let activeRun = null;

  async function persistState() {
    try {
      await writeMeetingScheduleState(statePath, state);
    } catch (error) {
      onError(error);
    }
  }

  function queueNextRun() {
    if (stopped) return;
    if (timer !== null) clearTimer(timer);
    const nowMs = now();
    const delay = nextSchedulerDelay(
      state.meetings,
      nowMs,
      lastRefreshAttemptMs,
      refreshIntervalMs,
    );
    timer = setTimer(() => {
      timer = null;
      void run();
    }, delay);
  }

  async function performRun(forceRefresh = false) {
    const nowMs = now();
    const shouldRefresh = forceRefresh
      || lastRefreshAttemptMs === 0
      || nowMs - lastRefreshAttemptMs >= refreshIntervalMs;

    if (shouldRefresh) {
      lastRefreshAttemptMs = nowMs;
      try {
        state.meetings = normalizeMeetingSchedule(await fetchMeetings(), nowMs);
        state.updatedAt = new Date(nowMs).toISOString();
      } catch (error) {
        // A failed refresh is expected when Tailscale DNS/the proxy is absent.
        // Keep using the last durable schedule snapshot and retry later.
        onError(error);
      }
    }

    state.notifiedOccurrences = pruneNotifications(state.notifiedOccurrences, nowMs);
    const due = findDueMeetings(state.meetings, state.notifiedOccurrences, nowMs);
    for (const meeting of due) {
      try {
        await onMeetingStart(meeting);
        state.notifiedOccurrences[meetingOccurrenceKey(meeting)] =
          new Date(nowMs).toISOString();
      } catch (error) {
        onError(error);
      }
    }

    await persistState();
    queueNextRun();
    return due;
  }

  function run(forceRefresh = false) {
    if (stopped) return Promise.resolve([]);
    if (activeRun) return activeRun;
    activeRun = performRun(forceRefresh).finally(() => {
      activeRun = null;
    });
    return activeRun;
  }

  return {
    async start() {
      if (!stopped) return [];
      stopped = false;
      state = await readMeetingScheduleState(statePath);
      return run(true);
    },
    stop() {
      stopped = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
    checkNow: () => run(true),
    getState: () => structuredClone(state),
  };
}
