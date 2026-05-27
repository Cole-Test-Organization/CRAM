// Themes — visual styling stored in the database so users can switch between
// pre-built themes and create their own. Two tables:
//
//   themes:              both built-in (user_id IS NULL) and user-authored
//                        themes. theme_data JSONB holds color ramps, fonts,
//                        and effects (scanlines, highlight color); the GUI
//                        applies it as CSS custom properties at runtime.
//
//   user_theme_settings: per-user pointer to whichever theme is currently
//                        active. ON DELETE SET NULL on the FK so a user
//                        deleting their own active theme doesn't break their
//                        next page load (it falls through to the default
//                        built-in instead).

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE themes (
      id          BIGSERIAL PRIMARY KEY,
      user_id     BIGINT REFERENCES users(id) ON DELETE CASCADE,
      slug        TEXT NOT NULL,
      name        TEXT NOT NULL,
      description TEXT,
      theme_data  JSONB NOT NULL,
      is_builtin  BOOLEAN NOT NULL DEFAULT FALSE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Postgres treats NULL as distinct in plain UNIQUE constraints, so we
    -- split slug-uniqueness into two partial indexes: globally-unique slugs
    -- for built-ins (user_id IS NULL), per-user-unique slugs for custom themes.
    CREATE UNIQUE INDEX themes_builtin_slug_uniq ON themes(slug) WHERE user_id IS NULL;
    CREATE UNIQUE INDEX themes_user_slug_uniq    ON themes(user_id, slug) WHERE user_id IS NOT NULL;
    CREATE INDEX themes_user_id_idx              ON themes(user_id);

    CREATE TRIGGER themes_updated_at BEFORE UPDATE ON themes
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  pgm.sql(`
    ALTER TABLE themes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE themes FORCE  ROW LEVEL SECURITY;

    -- Any user can SELECT built-ins (user_id IS NULL) and their own rows.
    CREATE POLICY themes_select ON themes
      FOR SELECT
      USING (user_id IS NULL
             OR user_id = current_setting('app.current_user_id', true)::bigint);

    -- INSERT/UPDATE/DELETE only touch the caller's own non-builtin rows.
    -- Built-ins are managed exclusively by migrations.
    CREATE POLICY themes_insert ON themes
      FOR INSERT
      WITH CHECK (user_id = current_setting('app.current_user_id', true)::bigint
                  AND is_builtin = FALSE);
    CREATE POLICY themes_update ON themes
      FOR UPDATE
      USING      (user_id = current_setting('app.current_user_id', true)::bigint
                  AND is_builtin = FALSE)
      WITH CHECK (user_id = current_setting('app.current_user_id', true)::bigint
                  AND is_builtin = FALSE);
    CREATE POLICY themes_delete ON themes
      FOR DELETE
      USING      (user_id = current_setting('app.current_user_id', true)::bigint
                  AND is_builtin = FALSE);
  `);

  pgm.sql(`
    CREATE TABLE user_theme_settings (
      user_id         BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      active_theme_id BIGINT REFERENCES themes(id) ON DELETE SET NULL,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TRIGGER user_theme_settings_updated_at BEFORE UPDATE ON user_theme_settings
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    ALTER TABLE user_theme_settings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE user_theme_settings FORCE  ROW LEVEL SECURITY;
    CREATE POLICY user_theme_settings_isolation ON user_theme_settings
      FOR ALL
      USING      (user_id = current_setting('app.current_user_id', true)::bigint)
      WITH CHECK (user_id = current_setting('app.current_user_id', true)::bigint);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP POLICY IF EXISTS user_theme_settings_isolation ON user_theme_settings;
    ALTER TABLE user_theme_settings DISABLE ROW LEVEL SECURITY;
    DROP TABLE IF EXISTS user_theme_settings;

    DROP POLICY IF EXISTS themes_select ON themes;
    DROP POLICY IF EXISTS themes_insert ON themes;
    DROP POLICY IF EXISTS themes_update ON themes;
    DROP POLICY IF EXISTS themes_delete ON themes;
    ALTER TABLE themes DISABLE ROW LEVEL SECURITY;
    DROP TABLE IF EXISTS themes;
  `);
};
