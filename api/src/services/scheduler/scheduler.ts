// A tiny, durable, multi-replica-safe recurring-task scheduler.
//
// There is no cron/queue library in this repo (backups once had a scheduler; it
// was removed). This fills that gap with the same durability model the
// provisioning job worker uses: a Postgres claim table. Register named tasks
// with a schedule + handler; a single poll loop (started on boot in the API
// process, like the provisioning worker) checks each tick whether a task is due
// and, if so, claims the occurrence via an atomic INSERT ... ON CONFLICT on
// `scheduled_task_runs`. The UNIQUE (task_name, period_key) constraint means
// exactly one replica ever runs a given occurrence — safe under Azure scale-out,
// where an in-memory setInterval would double-fire.
//
// To schedule something new: `scheduler.register({ name, schedule, handler })`
// in api/src/index.ts before `scheduler.start()`. Today only 'daily' schedules
// exist; add other `kind`s to Schedule + duePeriodKey() as needed.

import { getPool } from '../../db/connection.js';
import { logger as rootLogger } from '../../lib/logger.js';

const logger = rootLogger.child({ component: 'scheduler' });

export interface DailySchedule {
  kind: 'daily';
  hour: number; // 0-23, wall-clock in `tz`
  minute: number; // 0-59
  tz: string; // IANA zone, e.g. 'America/New_York'
}

export type Schedule = DailySchedule;

export interface ScheduledTask {
  name: string;
  schedule: Schedule;
  // Handlers own their own error handling for partial work; a throw is caught,
  // logged, and recorded as a failed run (the occurrence is still consumed — a
  // daily task that throws does not retry until its next period).
  handler: () => Promise<void>;
}

export interface SchedulerOptions {
  pollMs?: number;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Wall-clock parts (date + hour/minute) for `date` rendered in `tz`. Uses Intl so
// DST transitions are handled correctly (the zone, not a fixed offset, decides
// the local hour).
function wallClock(date: Date, tz: string): { day: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const p: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') p[part.type] = part.value;
  }
  // Some engines render midnight as hour "24"; normalize to 0.
  let hour = parseInt(p.hour, 10);
  if (hour === 24) hour = 0;
  return { day: `${p.year}-${p.month}-${p.day}`, hour, minute: parseInt(p.minute, 10) };
}

// The period key identifies "which occurrence" — for a daily task, the local
// calendar date. Returns the key when the task is due (now is at/after its
// scheduled wall-clock time for the current period), else null. Because the
// claim table dedupes, returning the key repeatedly through the day is fine: the
// first tick past the trigger claims it and the rest no-op. Exported for tests.
export function duePeriodKey(schedule: Schedule, now: Date): string | null {
  const { day, hour, minute } = wallClock(now, schedule.tz);
  const nowMinutes = hour * 60 + minute;
  const triggerMinutes = schedule.hour * 60 + schedule.minute;
  if (nowMinutes < triggerMinutes) return null;
  return day;
}

export class Scheduler {
  private tasks: ScheduledTask[] = [];
  private readonly pollMs: number;
  private running = false;
  private loopPromise: Promise<void> | null = null;

  constructor(options: SchedulerOptions = {}) {
    // A daily task tolerates up to a minute of lateness; 60s keeps DB chatter
    // negligible. Override for tests.
    this.pollMs = options.pollMs ?? 60_000;
  }

  register(task: ScheduledTask): void {
    if (this.tasks.some((t) => t.name === task.name)) {
      throw new Error(`Scheduler task already registered: ${task.name}`);
    }
    this.tasks.push(task);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.loopPromise = this.loop();
    logger.info({ tasks: this.tasks.map((t) => t.name), pollMs: this.pollMs }, 'scheduler started');
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loopPromise?.catch(() => undefined);
    this.loopPromise = null;
  }

  private async loop(): Promise<void> {
    // Tick once immediately so a scheduled time that already passed today while
    // the process was down is caught up on boot, then every pollMs.
    while (this.running) {
      try {
        await this.tick(new Date());
      } catch (err) {
        logger.error({ err: errMessage(err) }, 'scheduler tick failed');
      }
      await this.interruptibleSleep(this.pollMs);
    }
  }

  // Sleep in short steps so stop() isn't blocked for a whole poll interval.
  private async interruptibleSleep(ms: number): Promise<void> {
    const step = 1000;
    let waited = 0;
    while (this.running && waited < ms) {
      await sleep(Math.min(step, ms - waited));
      waited += step;
    }
  }

  // Visible for testing: run one scheduling pass at a given instant.
  async tick(now: Date): Promise<void> {
    for (const task of this.tasks) {
      const periodKey = duePeriodKey(task.schedule, now);
      if (!periodKey) continue;
      let claimed = false;
      try {
        claimed = await this.claim(task.name, periodKey);
      } catch (err) {
        logger.error({ task: task.name, err: errMessage(err) }, 'scheduled task claim failed');
        continue;
      }
      if (!claimed) continue; // already ran/claimed this period (here or on another replica)
      logger.info({ task: task.name, period: periodKey }, 'running scheduled task');
      let error: string | null = null;
      try {
        await task.handler();
      } catch (err) {
        error = errMessage(err);
        logger.error({ task: task.name, period: periodKey, err: error }, 'scheduled task failed');
      }
      await this.finish(task.name, periodKey, error).catch((err) =>
        logger.error({ task: task.name, err: errMessage(err) }, 'scheduled task finalize failed'),
      );
    }
  }

  // Atomic single-fire claim. The UNIQUE (task_name, period_key) constraint means
  // only the first inserter gets a row back; concurrent replicas get 0 rows and
  // skip. Runs on the raw pool — scheduled_task_runs is infra (no RLS), so no
  // user context is needed.
  private async claim(taskName: string, periodKey: string): Promise<boolean> {
    const res = await getPool().query(
      `INSERT INTO scheduled_task_runs (task_name, period_key, status)
       VALUES ($1, $2, 'running')
       ON CONFLICT (task_name, period_key) DO NOTHING
       RETURNING id`,
      [taskName, periodKey],
    );
    return (res.rowCount ?? 0) > 0;
  }

  private async finish(taskName: string, periodKey: string, error: string | null): Promise<void> {
    await getPool().query(
      `UPDATE scheduled_task_runs
          SET status = $3, error = $4, finished_at = NOW()
        WHERE task_name = $1 AND period_key = $2`,
      [taskName, periodKey, error ? 'failed' : 'completed', error],
    );
  }
}
