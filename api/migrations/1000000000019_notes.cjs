// Polymorphic notes: a single row attaches a timestamped markdown blurb to
// exactly one of account / contact / opportunity. CHECK enforces the
// exactly-one rule (NULLs counted via num_nonnulls).
//
// Per-user RLS in the standard pattern. Each FK has its own index so the
// per-entity feed query is cheap; (account_id, created_at DESC) and friends
// give the "newest first" feed ordering for free.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE notes (
      id              BIGSERIAL PRIMARY KEY,
      user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      account_id      BIGINT REFERENCES accounts(id)      ON DELETE CASCADE,
      contact_id      BIGINT REFERENCES contacts(id)      ON DELETE CASCADE,
      opportunity_id  BIGINT REFERENCES opportunities(id) ON DELETE CASCADE,
      body            TEXT NOT NULL DEFAULT '',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT notes_exactly_one_target
        CHECK (num_nonnulls(account_id, contact_id, opportunity_id) = 1)
    );
    CREATE INDEX idx_notes_user           ON notes(user_id);
    CREATE INDEX idx_notes_account_feed   ON notes(account_id, created_at DESC)     WHERE account_id IS NOT NULL;
    CREATE INDEX idx_notes_contact_feed   ON notes(contact_id, created_at DESC)     WHERE contact_id IS NOT NULL;
    CREATE INDEX idx_notes_opp_feed       ON notes(opportunity_id, created_at DESC) WHERE opportunity_id IS NOT NULL;
    CREATE TRIGGER notes_updated_at BEFORE UPDATE ON notes
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  pgm.sql(`
    ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE notes FORCE  ROW LEVEL SECURITY;
    CREATE POLICY notes_isolation ON notes
      FOR ALL
      USING      (user_id = current_setting('app.current_user_id', true)::bigint)
      WITH CHECK (user_id = current_setting('app.current_user_id', true)::bigint);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP POLICY IF EXISTS notes_isolation ON notes;
    ALTER TABLE notes DISABLE ROW LEVEL SECURITY;
    DROP TABLE IF EXISTS notes;
  `);
};
