// Per-user agent provider settings — provider name, default model, and local
// inference server URL. Previously these were browser localStorage on the
// Agent page, which meant background workers (e.g. the from-emails contact
// enrichment formatter) couldn't see them and had to fall back to env vars.
// Now stored server-side so any worker that needs to call the LLM can resolve
// the user's configured backend.
//
// One row per user, upserted on update. Standard per-user RLS pattern.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE user_agent_settings (
      user_id        BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      provider       TEXT,
      model          TEXT,
      local_base_url TEXT,
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TRIGGER user_agent_settings_updated_at BEFORE UPDATE ON user_agent_settings
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  pgm.sql(`
    ALTER TABLE user_agent_settings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE user_agent_settings FORCE  ROW LEVEL SECURITY;
    CREATE POLICY user_agent_settings_isolation ON user_agent_settings
      FOR ALL
      USING      (user_id = current_setting('app.current_user_id', true)::bigint)
      WITH CHECK (user_id = current_setting('app.current_user_id', true)::bigint);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP POLICY IF EXISTS user_agent_settings_isolation ON user_agent_settings;
    ALTER TABLE user_agent_settings DISABLE ROW LEVEL SECURITY;
    DROP TABLE IF EXISTS user_agent_settings;
  `);
};
