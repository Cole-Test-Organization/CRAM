// Add an AI Security category to account_details so we can track AI-specific
// security tooling (Prisma AIRS, AI Runtime Security, model firewalls, etc.)
// alongside the other vendor product references. Mirrors the pattern for the
// other *_ids array columns added in migration 1000000000016 — bigint[] with
// a GIN index, default empty, never null.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE account_details
      ADD COLUMN ai_security_ids BIGINT[] NOT NULL DEFAULT '{}';

    CREATE INDEX idx_account_details_ai_security_ids ON account_details USING GIN (ai_security_ids);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_account_details_ai_security_ids;
    ALTER TABLE account_details DROP COLUMN ai_security_ids;
  `);
};
