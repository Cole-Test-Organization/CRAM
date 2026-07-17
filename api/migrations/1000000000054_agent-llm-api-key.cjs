// Store each user's local-LLM bearer token alongside their agent settings, but
// never as plaintext. The API encrypts/decrypts with the same AES-256-GCM
// helper used by the existing secrets vault; Postgres only receives ciphertext,
// the per-write IV, and the authentication tag. All encrypted fields are either
// present together or absent together (a cleared token).

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE user_agent_settings
      ADD COLUMN local_api_key_ciphertext BYTEA,
      ADD COLUMN local_api_key_iv         BYTEA,
      ADD COLUMN local_api_key_auth_tag   BYTEA,
      ADD COLUMN local_api_key_algo       TEXT,
      ADD COLUMN local_api_key_key_version INTEGER;

    ALTER TABLE user_agent_settings
      ADD CONSTRAINT user_agent_settings_local_api_key_encrypted_check
      CHECK (
        (
          local_api_key_ciphertext IS NULL AND
          local_api_key_iv IS NULL AND
          local_api_key_auth_tag IS NULL AND
          local_api_key_algo IS NULL AND
          local_api_key_key_version IS NULL
        ) OR (
          local_api_key_ciphertext IS NOT NULL AND
          local_api_key_iv IS NOT NULL AND
          local_api_key_auth_tag IS NOT NULL AND
          local_api_key_algo IS NOT NULL AND
          local_api_key_key_version IS NOT NULL
        )
      );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE user_agent_settings
      DROP CONSTRAINT IF EXISTS user_agent_settings_local_api_key_encrypted_check,
      DROP COLUMN IF EXISTS local_api_key_key_version,
      DROP COLUMN IF EXISTS local_api_key_algo,
      DROP COLUMN IF EXISTS local_api_key_auth_tag,
      DROP COLUMN IF EXISTS local_api_key_iv,
      DROP COLUMN IF EXISTS local_api_key_ciphertext;
  `);
};
