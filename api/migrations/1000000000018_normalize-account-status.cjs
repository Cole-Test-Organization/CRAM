// Collapse the "customer" terminology to "account" across the data model.
//
// Two parallel renames:
//   1. accounts.status — was free-text with 'customer', 'prospect', 'partner',
//      NULL, etc. Now it's binary: 'partner' (channel partners you sell with)
//      vs 'account' (everything else — companies you sell to, regardless of
//      whether the deal is closed or just prospective). There is no functional
//      difference between a prospect and a closed-won customer in the UI.
//
//   2. contacts.kind — was constrained to ('customer', 'partner', 'internal').
//      'customer' becomes 'account' to match the account-side terminology.
//      The CHECK constraint and column default both move with it.
//
// Idempotent: re-running on already-normalized rows is a no-op (the UPDATE
// matches no rows, and the CHECK rebuild is conditional on the constraint
// definition).

exports.up = (pgm) => {
  // Accounts: anything that isn't 'partner' becomes 'account'.
  pgm.sql(`
    UPDATE accounts
    SET status = 'account'
    WHERE status IS NULL
       OR LOWER(status) NOT IN ('partner', 'account');
  `);

  // Contacts: swap the CHECK constraint, default, and existing data.
  // Order: drop check → migrate data → add new check → update default.
  pgm.sql(`
    DO $$
    DECLARE
      check_name TEXT;
    BEGIN
      SELECT con.conname INTO check_name
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      WHERE rel.relname = 'contacts'
        AND con.contype = 'c'
        AND pg_get_constraintdef(con.oid) ILIKE '%kind%';
      IF check_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE contacts DROP CONSTRAINT %I', check_name);
      END IF;
    END $$;
  `);

  pgm.sql(`UPDATE contacts SET kind = 'account' WHERE kind = 'customer';`);

  pgm.sql(`
    ALTER TABLE contacts
      ADD CONSTRAINT contacts_kind_check
      CHECK (kind IN ('account', 'partner', 'internal'));
    ALTER TABLE contacts ALTER COLUMN kind SET DEFAULT 'account';
  `);
};

exports.down = () => {
  // No-op: the original status values ('customer', 'prospect', NULL, …) are
  // not recoverable on the accounts side. The contacts.kind swap is reversible
  // in principle, but rolling it back without also reverting the application
  // code would leave the system inconsistent — a real rollback needs a DB
  // restore.
};
