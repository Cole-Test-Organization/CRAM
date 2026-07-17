// Make org-chart membership explicit:
//   no row                    -> contact is not in the chart
//   reports_to_contact_id NULL -> explicit top-level contact
//   reports_to_contact_id set  -> contact reports to that chart member
//
// The original edge-only table could not distinguish an unassigned contact
// from a root. Preserve every existing reporting chain by materializing its
// referenced top-level managers; unrelated account contacts remain unassigned.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE account_contact_reporting
      ALTER COLUMN reports_to_contact_id DROP NOT NULL;

    DROP POLICY account_contact_reporting_isolation ON account_contact_reporting;
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
        AND (
          account_contact_reporting.reports_to_contact_id IS NULL
          OR EXISTS (
            SELECT 1 FROM account_contacts ac
            WHERE ac.account_id = account_contact_reporting.account_id
              AND ac.contact_id = account_contact_reporting.reports_to_contact_id
          )
        )
      );

    INSERT INTO account_contact_reporting (account_id, contact_id, reports_to_contact_id)
    SELECT DISTINCT edge.account_id, edge.reports_to_contact_id, NULL::bigint
    FROM account_contact_reporting edge
    LEFT JOIN account_contact_reporting manager
      ON manager.account_id = edge.account_id
     AND manager.contact_id = edge.reports_to_contact_id
    WHERE manager.contact_id IS NULL;

    ALTER TABLE account_contact_reporting
      ADD CONSTRAINT account_contact_reporting_manager_node_fkey
      FOREIGN KEY (account_id, reports_to_contact_id)
      REFERENCES account_contact_reporting(account_id, contact_id)
      ON DELETE CASCADE
      DEFERRABLE INITIALLY DEFERRED;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE account_contact_reporting
      DROP CONSTRAINT IF EXISTS account_contact_reporting_manager_node_fkey;

    DELETE FROM account_contact_reporting WHERE reports_to_contact_id IS NULL;

    DROP POLICY account_contact_reporting_isolation ON account_contact_reporting;
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

    ALTER TABLE account_contact_reporting
      ALTER COLUMN reports_to_contact_id SET NOT NULL;
  `);
};
