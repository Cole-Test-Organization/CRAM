// Account-scoped org chart edges. Contacts are global people and account links
// are many-to-many through account_contacts, so reporting relationships must
// live on the account/contact membership rather than on contacts directly.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE account_contact_reporting (
      account_id            BIGINT NOT NULL,
      contact_id            BIGINT NOT NULL,
      reports_to_contact_id BIGINT NOT NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (account_id, contact_id),
      CHECK (contact_id <> reports_to_contact_id),
      FOREIGN KEY (account_id, contact_id)
        REFERENCES account_contacts(account_id, contact_id)
        ON DELETE CASCADE,
      FOREIGN KEY (account_id, reports_to_contact_id)
        REFERENCES account_contacts(account_id, contact_id)
        ON DELETE CASCADE
    );

    CREATE INDEX idx_acr_manager
      ON account_contact_reporting(account_id, reports_to_contact_id);

    CREATE TRIGGER account_contact_reporting_updated_at
      BEFORE UPDATE ON account_contact_reporting
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    ALTER TABLE account_contact_reporting ENABLE ROW LEVEL SECURITY;
    ALTER TABLE account_contact_reporting FORCE ROW LEVEL SECURITY;

    CREATE POLICY account_contact_reporting_isolation ON account_contact_reporting
      FOR ALL
      USING (
        EXISTS (SELECT 1 FROM accounts a WHERE a.id = account_contact_reporting.account_id)
      )
      WITH CHECK (
        EXISTS (SELECT 1 FROM accounts a WHERE a.id = account_contact_reporting.account_id)
        AND EXISTS (
          SELECT 1 FROM account_contacts ac
          WHERE ac.account_id = account_contact_reporting.account_id
            AND ac.contact_id = account_contact_reporting.contact_id
        )
        AND EXISTS (
          SELECT 1 FROM account_contacts ac
          WHERE ac.account_id = account_contact_reporting.account_id
            AND ac.contact_id = account_contact_reporting.reports_to_contact_id
        )
      );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP POLICY IF EXISTS account_contact_reporting_isolation ON account_contact_reporting;
    ALTER TABLE account_contact_reporting DISABLE ROW LEVEL SECURITY;
    DROP TABLE IF EXISTS account_contact_reporting;
  `);
};
