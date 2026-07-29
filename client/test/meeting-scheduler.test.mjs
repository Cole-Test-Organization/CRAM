import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createMeetingScheduler,
  DEFAULT_MEETING_DURATION_MS,
  findDueMeetings,
  meetingOccurrenceKey,
  nextSchedulerDelay,
  normalizeMeetingSchedule,
  readMeetingScheduleState,
  writeMeetingScheduleState,
} from '../src/meeting-scheduler.mjs';

function iso(timestamp) {
  return new Date(timestamp).toISOString();
}

test('normalizes timed meeting metadata and drops invalid or distant rows', () => {
  const now = Date.parse('2026-07-29T12:00:00.000Z');
  const meetings = normalizeMeetingSchedule([
    { id: 2, starts_at: iso(now + 60_000), title: 'Second' },
    { id: 1, starts_at: iso(now), ends_at: iso(now + 30 * 60_000), title: 'First' },
    { id: 0, starts_at: iso(now) },
    { id: 3, starts_at: 'not-a-date' },
    { id: 4, starts_at: iso(now + 60 * 24 * 60 * 60_000) },
  ], now);

  assert.deepEqual(meetings.map((meeting) => meeting.id), [1, 2]);
  assert.equal(meetings[0].ends_at, iso(now + 30 * 60_000));
  assert.equal(meetings[1].ends_at, null);
});

test('opens meetings that are currently active and de-duplicates each start occurrence', () => {
  const now = Date.parse('2026-07-29T12:15:00.000Z');
  const current = {
    id: 7,
    starts_at: iso(now - 15 * 60_000),
    ends_at: iso(now + 15 * 60_000),
  };
  const assumedDuration = {
    id: 8,
    starts_at: iso(now - DEFAULT_MEETING_DURATION_MS + 60_000),
    ends_at: null,
  };

  assert.deepEqual(
    findDueMeetings([current, assumedDuration], {}, now).map((meeting) => meeting.id),
    [8, 7],
  );
  assert.deepEqual(
    findDueMeetings([current], new Set([meetingOccurrenceKey(current)]), now),
    [],
  );
});

test('wakes at the next meeting start when it is sooner than the schedule refresh', () => {
  const now = Date.parse('2026-07-29T12:00:00.000Z');
  const delay = nextSchedulerDelay(
    [{ id: 1, starts_at: iso(now + 45_000) }],
    now,
    now,
    5 * 60_000,
  );

  assert.equal(delay, 45_000);
});

test('schedule state is durable and private-file compatible', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cram-meeting-schedule-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, 'nested', 'schedule.json');
  const now = Date.now();
  const state = {
    version: 1,
    updatedAt: iso(now),
    meetings: [{ id: 11, starts_at: iso(now + 60_000), ends_at: null }],
    notifiedOccurrences: {},
  };

  await writeMeetingScheduleState(statePath, state);
  const stored = await readMeetingScheduleState(statePath);

  assert.equal(stored.version, 1);
  assert.equal(stored.meetings[0].id, 11);
  assert.equal(stored.updatedAt, state.updatedAt);
});

test('uses the local schedule when refresh is unreachable and fires only once', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cram-meeting-scheduler-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, 'schedule.json');
  const now = Date.now();
  const meeting = {
    id: 19,
    starts_at: iso(now - 60_000),
    ends_at: iso(now + 30 * 60_000),
    title: 'Offline meeting',
  };
  await writeMeetingScheduleState(statePath, {
    version: 1,
    updatedAt: iso(now - 5 * 60_000),
    meetings: [meeting],
    notifiedOccurrences: {},
  });

  const opened = [];
  const errors = [];
  const scheduler = createMeetingScheduler({
    statePath,
    fetchMeetings: async () => {
      throw new TypeError('DNS unavailable');
    },
    onMeetingStart: async (value) => opened.push(value.id),
    now: () => now,
    setTimer: () => 1,
    clearTimer: () => {},
    onError: (error) => errors.push(error.message),
  });
  t.after(() => scheduler.stop());

  await scheduler.start();
  await scheduler.checkNow();

  assert.deepEqual(opened, [19]);
  assert.deepEqual(errors, ['DNS unavailable', 'DNS unavailable']);
  const stored = await readMeetingScheduleState(statePath);
  assert.ok(stored.notifiedOccurrences[meetingOccurrenceKey(meeting)]);
});
