// Per-user list of "internal" email domains — the domains belonging to the
// user's own company. The from-emails meeting flow uses this to flag
// attendees from these domains as kind=internal (so they don't trigger
// account creation or get queued for LinkedIn enrichment). Replaces the env
// var SELF_DOMAINS / INTERNAL_DOMAINS as the source of truth; the env var
// stays available as a bootstrap default for fresh installs.
//
// Standard per-user RLS pattern. Domains stored as plain text but always
// normalized to lowercase, www./protocol/subpath stripped (matches the same
// normalization the from-emails resolver does on the attendee side).

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE user_internal_domains (
      user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      domain     TEXT   NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, domain),
      CONSTRAINT user_internal_domains_lowercase CHECK (domain = LOWER(domain))
    );
    CREATE INDEX idx_user_internal_domains_user ON user_internal_domains(user_id);
  `);

  pgm.sql(`
    ALTER TABLE user_internal_domains ENABLE ROW LEVEL SECURITY;
    ALTER TABLE user_internal_domains FORCE  ROW LEVEL SECURITY;
    CREATE POLICY user_internal_domains_isolation ON user_internal_domains
      FOR ALL
      USING      (user_id = current_setting('app.current_user_id', true)::bigint)
      WITH CHECK (user_id = current_setting('app.current_user_id', true)::bigint);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP POLICY IF EXISTS user_internal_domains_isolation ON user_internal_domains;
    ALTER TABLE user_internal_domains DISABLE ROW LEVEL SECURITY;
    DROP TABLE IF EXISTS user_internal_domains;
  `);
};
