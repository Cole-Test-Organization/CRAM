// accounts.needs_review — a triage flag for accounts the notes-import pipeline
// (or the agent) created speculatively. When an imported note names a company
// that doesn't match any existing account, we auto-create the account so the
// note has a home, but flag it so the user can verify/merge it later rather
// than trusting a machine-minted row. Mirrors vendor_products.needs_review and
// meetings.needs_review (1000000000033) — same shape, same partial index so the
// review queue is a cheap indexed lookup.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE accounts ADD COLUMN needs_review BOOLEAN NOT NULL DEFAULT false;
    CREATE INDEX idx_accounts_needs_review ON accounts (needs_review) WHERE needs_review = true;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_accounts_needs_review;
    ALTER TABLE accounts DROP COLUMN needs_review;
  `);
};
