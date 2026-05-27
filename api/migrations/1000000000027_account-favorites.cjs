// Per-account boolean flag the user can toggle from the account list to pin
// the row to the top of the listing. Lives on the account row (not a separate
// table) — same RLS as the rest of the row, so it's already per-user-scoped.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE accounts
      ADD COLUMN favorite BOOLEAN NOT NULL DEFAULT false;
    CREATE INDEX idx_accounts_favorite ON accounts(favorite) WHERE favorite = true;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_accounts_favorite;
    ALTER TABLE accounts DROP COLUMN IF EXISTS favorite;
  `);
};
