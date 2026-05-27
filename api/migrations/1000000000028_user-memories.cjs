// Per-user agent memories — long-lived preferences, rules, and facts the user
// wants the agent to apply across sessions. Enabled rows are rendered into the
// instructions markdown at session start so the model gets them in its system
// prompt without having to discover/fetch them via a tool.
//
// The LLM may save memories via the `memories` MCP tool, but workflow guidance
// instructs it to only do so on explicit user request. Full CRUD is exposed on
// both surfaces so the UI can manage the list. Standard per-user RLS pattern.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE user_memories (
      id         BIGSERIAL PRIMARY KEY,
      user_id    BIGINT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title      TEXT,
      content    TEXT    NOT NULL,
      enabled    BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT user_memories_content_nonempty CHECK (length(btrim(content)) > 0)
    );
    CREATE INDEX idx_user_memories_user_enabled ON user_memories(user_id, enabled);
    CREATE TRIGGER user_memories_updated_at BEFORE UPDATE ON user_memories
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  pgm.sql(`
    ALTER TABLE user_memories ENABLE ROW LEVEL SECURITY;
    ALTER TABLE user_memories FORCE  ROW LEVEL SECURITY;
    CREATE POLICY user_memories_isolation ON user_memories
      FOR ALL
      USING      (user_id = current_setting('app.current_user_id', true)::bigint)
      WITH CHECK (user_id = current_setting('app.current_user_id', true)::bigint);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP POLICY IF EXISTS user_memories_isolation ON user_memories;
    ALTER TABLE user_memories DISABLE ROW LEVEL SECURITY;
    DROP TABLE IF EXISTS user_memories;
  `);
};
