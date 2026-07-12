// Per-account news. Google News RSS headlines are fetched for an account's
// company name and ranked by the user's configured local LLM (order only — we
// never store article bodies, just headline + link + source + date). Three
// tables, all standard per-user RLS:
//
//   user_news_settings    — one row per user: the global ranking prompt. NULL
//                           means "use the built-in default" (same contract as
//                           user_agent_settings.system_prompt) — we deliberately
//                           don't seed the default text; it lives in code.
//   account_news_settings — one row per account: an optional per-account ranking
//                           prompt override (NULL = fall back to the global one)
//                           plus the last-refresh status/timestamp so the GUI can
//                           show "Last refreshed …" and poll a running refresh.
//   account_news          — the current ranked headline snapshot for an account,
//                           replaced wholesale on each refresh; `rank` is the
//                           LLM's best-to-worst ordering (0-based).

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE user_news_settings (
      user_id        BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      ranking_prompt TEXT,
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TRIGGER user_news_settings_updated_at BEFORE UPDATE ON user_news_settings
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE TABLE account_news_settings (
      account_id      BIGINT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ranking_prompt  TEXT,
      last_status     TEXT,
      last_error      TEXT,
      last_fetched_at TIMESTAMPTZ,
      article_count   INTEGER NOT NULL DEFAULT 0,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX idx_account_news_settings_user ON account_news_settings(user_id);
    CREATE TRIGGER account_news_settings_updated_at BEFORE UPDATE ON account_news_settings
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE TABLE account_news (
      id           BIGSERIAL PRIMARY KEY,
      user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      account_id   BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      title        TEXT NOT NULL,
      url          TEXT NOT NULL,
      source       TEXT,
      published_at TIMESTAMPTZ,
      rank         INTEGER NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX idx_account_news_feed ON account_news(account_id, rank);
    CREATE INDEX idx_account_news_user ON account_news(user_id);
  `);

  pgm.sql(`
    ALTER TABLE user_news_settings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE user_news_settings FORCE  ROW LEVEL SECURITY;
    CREATE POLICY user_news_settings_isolation ON user_news_settings
      FOR ALL
      USING      (user_id = current_setting('app.current_user_id', true)::bigint)
      WITH CHECK (user_id = current_setting('app.current_user_id', true)::bigint);

    ALTER TABLE account_news_settings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE account_news_settings FORCE  ROW LEVEL SECURITY;
    CREATE POLICY account_news_settings_isolation ON account_news_settings
      FOR ALL
      USING      (user_id = current_setting('app.current_user_id', true)::bigint)
      WITH CHECK (user_id = current_setting('app.current_user_id', true)::bigint);

    ALTER TABLE account_news ENABLE ROW LEVEL SECURITY;
    ALTER TABLE account_news FORCE  ROW LEVEL SECURITY;
    CREATE POLICY account_news_isolation ON account_news
      FOR ALL
      USING      (user_id = current_setting('app.current_user_id', true)::bigint)
      WITH CHECK (user_id = current_setting('app.current_user_id', true)::bigint);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP POLICY IF EXISTS account_news_isolation ON account_news;
    DROP POLICY IF EXISTS account_news_settings_isolation ON account_news_settings;
    DROP POLICY IF EXISTS user_news_settings_isolation ON user_news_settings;
    ALTER TABLE account_news DISABLE ROW LEVEL SECURITY;
    ALTER TABLE account_news_settings DISABLE ROW LEVEL SECURITY;
    ALTER TABLE user_news_settings DISABLE ROW LEVEL SECURITY;
    DROP TABLE IF EXISTS account_news;
    DROP TABLE IF EXISTS account_news_settings;
    DROP TABLE IF EXISTS user_news_settings;
  `);
};
