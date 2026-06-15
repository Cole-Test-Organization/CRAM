// User-initiated job cancellation for the provisioning DB-claim worker (Phase 2 of
// the broker migration; see BROKER-MIGRATION.md). The Phase 0 status CHECK in
// 1000000000040_provisioning.cjs only allowed queued/running/succeeded/failed; a
// real user cancel needs a terminal 'canceled' state plus a way to interrupt an
// already-running job.
//
//   - status gains 'canceled' (terminal).
//   - cancel_requested is a flag the worker polls while a job is 'running'. A cancel
//     request sets it true; the worker terminates the spawned terraform child and
//     transitions the job to 'canceled'. (Queued jobs can go straight to 'canceled'.)
//
// Numbered 043 to stay after 042 and clear of the krisp branch's 041.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE provisioning_jobs
      DROP CONSTRAINT IF EXISTS provisioning_jobs_status_check;
    ALTER TABLE provisioning_jobs
      ADD CONSTRAINT provisioning_jobs_status_check
      CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'canceled'));
    ALTER TABLE provisioning_jobs
      ADD COLUMN cancel_requested BOOLEAN NOT NULL DEFAULT FALSE;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE provisioning_jobs
      DROP COLUMN IF EXISTS cancel_requested;
    ALTER TABLE provisioning_jobs
      DROP CONSTRAINT IF EXISTS provisioning_jobs_status_check;
    ALTER TABLE provisioning_jobs
      ADD CONSTRAINT provisioning_jobs_status_check
      CHECK (status IN ('queued', 'running', 'succeeded', 'failed'));
  `);
};
