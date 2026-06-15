// Encrypted secrets at rest for the provisioning service (Phase 2 of the broker
// migration; see BROKER-MIGRATION.md). This supersedes the env-var indirection
// noted in 1000000000040_provisioning.cjs (lines 34-37): deployment config still
// references a secret by NAME — the broker's *Env keys, e.g. PANW_PANORAMA_AUTH_CODE,
// PROXMOX_VE_TOKEN, WINDOWS_ENDPOINT_ADMIN_PASSWORD — but the resolved value now
// lives here as AES-256-GCM ciphertext instead of in process.env.
//
// Crypto is app-side: the 32-byte master key lives in env (PROVISIONING_SECRETS_KEY);
// only ciphertext + the 12-byte GCM iv + 16-byte auth tag touch Postgres. algo and
// key_version are stored per row so the key can be rotated later without a schema
// change. Per-user RLS + set_updated_at trigger like the rest of the provisioning_*
// family. Never log decrypted values.
//
// Numbered 042 (not 041) to leave 041 to the in-flight krisp migration on the
// krisp_integration branch and avoid a duplicate migration number on merge.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE provisioning_secrets (
      id          BIGSERIAL PRIMARY KEY,
      user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      description TEXT,
      ciphertext  BYTEA NOT NULL,
      iv          BYTEA NOT NULL,
      auth_tag    BYTEA NOT NULL,
      algo        TEXT NOT NULL DEFAULT 'aes-256-gcm',
      key_version INTEGER NOT NULL DEFAULT 1,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, name)
    );
    CREATE INDEX idx_provisioning_secrets_user ON provisioning_secrets(user_id);
    CREATE TRIGGER provisioning_secrets_updated_at BEFORE UPDATE ON provisioning_secrets
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    ALTER TABLE provisioning_secrets ENABLE ROW LEVEL SECURITY;
    ALTER TABLE provisioning_secrets FORCE  ROW LEVEL SECURITY;
    CREATE POLICY provisioning_secrets_isolation ON provisioning_secrets
      FOR ALL
      USING      (user_id = current_setting('app.current_user_id', true)::bigint)
      WITH CHECK (user_id = current_setting('app.current_user_id', true)::bigint);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS provisioning_secrets;`);
};
