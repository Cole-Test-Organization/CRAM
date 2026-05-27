// Global key/value settings table. Currently holds the `backup` row that
// controls the scheduled pg_dump job. Intentionally NOT row-level-secured —
// backup config is admin/instance-wide, not per-tenant (a backup spans every
// user's data, so it can't be scoped by user_id). Future settings keys can
// land in here too.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE app_settings (
      key        TEXT PRIMARY KEY,
      value      JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TRIGGER app_settings_updated_at BEFORE UPDATE ON app_settings
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // Seed the backup row with conservative defaults: disabled, daily at 02:00,
  // keep last 30 dumps. The bind-mounted /backups dir is the default target.
  pgm.sql(`
    INSERT INTO app_settings (key, value) VALUES (
      'backup',
      '{
        "enabled": false,
        "cron": "0 2 * * *",
        "retention_count": 30,
        "target_dir": "/backups"
      }'::jsonb
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS app_settings;`);
};
