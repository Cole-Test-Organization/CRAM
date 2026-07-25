// Stored output of a provisioning reconciliation run (see
// api/src/services/provisioning/reconcile.ts).
//
// Reconciliation spawns one cloud CLI call per tracked resource, serially, so it
// is far too expensive to run on a page load. Persisting each report lets the
// GUI render the last known answer instantly with a freshness stamp, while a
// scheduled background sweep keeps that answer current and the manual "check
// now" button stays for when the operator knows something just changed.
//
// `scope` is the deployment the run was limited to, or '' for a whole-broker
// sweep — the two are stored separately so a deployment-scoped check never
// masquerades as a full one. History is kept (bounded by a prune on write) so a
// run that reports drift can be compared against the previous one.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE provisioning_reconcile_reports (
      id         BIGSERIAL PRIMARY KEY,
      user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scope      TEXT NOT NULL DEFAULT '',
      source     TEXT NOT NULL DEFAULT 'manual',
      applied    BOOLEAN NOT NULL DEFAULT FALSE,
      checked_at TIMESTAMPTZ NOT NULL,
      summary    JSONB NOT NULL,
      report     JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT provisioning_reconcile_reports_source
        CHECK (source IN ('manual', 'scheduled'))
    );

    CREATE INDEX idx_provisioning_reconcile_reports_latest
      ON provisioning_reconcile_reports(user_id, scope, checked_at DESC);

    ALTER TABLE provisioning_reconcile_reports ENABLE ROW LEVEL SECURITY;
    ALTER TABLE provisioning_reconcile_reports FORCE  ROW LEVEL SECURITY;
    CREATE POLICY provisioning_reconcile_reports_isolation ON provisioning_reconcile_reports
      FOR ALL
      USING      (user_id = current_setting('app.current_user_id', true)::bigint)
      WITH CHECK (user_id = current_setting('app.current_user_id', true)::bigint);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS provisioning_reconcile_reports;`);
};
