exports.up = (pgm) => {
  const defaultEmail = process.env.DEFAULT_USER_EMAIL || 'default@local';
  const defaultName = process.env.DEFAULT_USER_NAME || 'Default User';

  pgm.sql(`
    CREATE TABLE users (
      id          BIGSERIAL PRIMARY KEY,
      email       TEXT NOT NULL UNIQUE,
      name        TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      disabled_at TIMESTAMPTZ
    );
    CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // Escape single quotes for safe literal insertion. These values come from
  // operator-controlled env vars, not user input.
  const esc = (s) => String(s).replace(/'/g, "''");
  pgm.sql(`INSERT INTO users (email, name) VALUES ('${esc(defaultEmail)}', '${esc(defaultName)}');`);

  pgm.sql(`
    ALTER TABLE accounts ADD COLUMN user_id BIGINT REFERENCES users(id) ON DELETE CASCADE;
    UPDATE accounts SET user_id = (SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL;
    ALTER TABLE accounts ALTER COLUMN user_id SET NOT NULL;
    CREATE INDEX idx_accounts_user ON accounts(user_id);

    ALTER TABLE contacts ADD COLUMN user_id BIGINT REFERENCES users(id) ON DELETE CASCADE;
    UPDATE contacts SET user_id = (SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL;
    ALTER TABLE contacts ALTER COLUMN user_id SET NOT NULL;
    CREATE INDEX idx_contacts_user ON contacts(user_id);

    ALTER TABLE meetings ADD COLUMN user_id BIGINT REFERENCES users(id) ON DELETE CASCADE;
    UPDATE meetings SET user_id = (SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL;
    ALTER TABLE meetings ALTER COLUMN user_id SET NOT NULL;
    CREATE INDEX idx_meetings_user ON meetings(user_id);

    ALTER TABLE internal_notes ADD COLUMN user_id BIGINT REFERENCES users(id) ON DELETE CASCADE;
    UPDATE internal_notes SET user_id = (SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL;
    ALTER TABLE internal_notes ALTER COLUMN user_id SET NOT NULL;
    CREATE INDEX idx_internal_user ON internal_notes(user_id);
  `);

  pgm.sql(`
    ALTER TABLE accounts DROP CONSTRAINT accounts_slug_key;
    ALTER TABLE accounts ADD CONSTRAINT accounts_user_slug_key UNIQUE (user_id, slug);

    ALTER TABLE internal_notes DROP CONSTRAINT internal_notes_filename_key;
    ALTER TABLE internal_notes ADD CONSTRAINT internal_notes_user_filename_key UNIQUE (user_id, filename);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE internal_notes DROP CONSTRAINT internal_notes_user_filename_key;
    ALTER TABLE internal_notes ADD CONSTRAINT internal_notes_filename_key UNIQUE (filename);
    ALTER TABLE accounts DROP CONSTRAINT accounts_user_slug_key;
    ALTER TABLE accounts ADD CONSTRAINT accounts_slug_key UNIQUE (slug);

    DROP INDEX IF EXISTS idx_internal_user;
    DROP INDEX IF EXISTS idx_meetings_user;
    DROP INDEX IF EXISTS idx_contacts_user;
    DROP INDEX IF EXISTS idx_accounts_user;

    ALTER TABLE internal_notes DROP COLUMN user_id;
    ALTER TABLE meetings DROP COLUMN user_id;
    ALTER TABLE contacts DROP COLUMN user_id;
    ALTER TABLE accounts DROP COLUMN user_id;

    DROP TABLE users;
  `);
};
