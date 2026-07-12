// Durable claim table for the in-process recurring-task scheduler
// (api/src/services/scheduler/scheduler.ts). Each registered task (e.g. the
// daily starred-account news refresh) fires at most once per "period" — for a
// daily task, one calendar date in the task's timezone. A run is claimed with
//   INSERT ... ON CONFLICT (task_name, period_key) DO NOTHING RETURNING id
// so the UNIQUE constraint makes the claim atomic: exactly one API replica runs
// a given occurrence, even under Azure scale-out. Infra table (not user data) —
// like app_settings it is intentionally NOT row-level-secured, so the worker can
// claim without a user context.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE scheduled_task_runs (
      id          BIGSERIAL PRIMARY KEY,
      task_name   TEXT NOT NULL,
      period_key  TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'running',
      started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      error       TEXT,
      detail      JSONB,
      CONSTRAINT scheduled_task_runs_once UNIQUE (task_name, period_key)
    );
    CREATE INDEX idx_scheduled_task_runs_recent ON scheduled_task_runs(task_name, started_at DESC);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS scheduled_task_runs;`);
};
