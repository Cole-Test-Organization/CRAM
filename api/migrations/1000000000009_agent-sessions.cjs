// Agent conversation history. Replaces the JSONL files Claude Code wrote under
// ~/.claude/projects/. One row per conversation; messages JSONB holds the full
// Anthropic-style message array so the loop can replay history for resume.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE agent_sessions (
      id          TEXT PRIMARY KEY,
      user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title       TEXT,
      provider    TEXT NOT NULL DEFAULT 'anthropic',
      model       TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
      messages    JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_agent_sessions_user_updated ON agent_sessions (user_id, updated_at DESC);

    CREATE TRIGGER agent_sessions_updated_at BEFORE UPDATE ON agent_sessions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    ALTER TABLE agent_sessions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE agent_sessions FORCE  ROW LEVEL SECURITY;

    CREATE POLICY agent_sessions_isolation ON agent_sessions
      FOR ALL
      USING      (user_id = current_setting('app.current_user_id', true)::bigint)
      WITH CHECK (user_id = current_setting('app.current_user_id', true)::bigint);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP POLICY IF EXISTS agent_sessions_isolation ON agent_sessions;
    ALTER TABLE agent_sessions DISABLE ROW LEVEL SECURITY;
    DROP TRIGGER IF EXISTS agent_sessions_updated_at ON agent_sessions;
    DROP TABLE IF EXISTS agent_sessions;
  `);
};
