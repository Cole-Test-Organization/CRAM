// Expand the set of categories linkable from account_details, drop a category
// that doesn't earn its keep, and consolidate "email & collab" into a single
// "productivity suite" concept.
//
// Changes:
//   1. RENAME account_details.email_collab_ids → productivity_suite_ids.
//      "Email" was already covered by email_security; the remaining concept is
//      really "what suite runs the desk" — collab/docs/email all bundled.
//   2. ADD account_details.cspm_ids, appsec_ids, ndr_ids, iot_ot_ids — the
//      seed catalog already has products in these categories (Wiz, Snyk,
//      Vectra, Claroty, etc.); now they're first-class on the per-account
//      profile and can be picked in the GUI / queried for analytics.
//   3. UPDATE vendor_products SET category='productivity_suite' WHERE
//      category='email_collab' — keep the existing rows pointing at the
//      renamed column.
//   4. DELETE the backup category entirely: removes the 3 backup products
//      (Veeam Backup & Replication, Rubrik Security Cloud, Cohesity
//      DataProtect) and the 3 vendors (Veeam, Rubrik, Cohesity) — none of
//      them have any other products in the catalog. If you later care about
//      tracking backup providers, re-add the category and the columns.
//
// Safety: account_details *_ids arrays don't have FK enforcement, so we scrub
// any backup product IDs out of every existing array column before deleting.
// At the time this migration ships none should exist (backup wasn't linkable),
// but the scrub keeps the migration safe to apply against later environments
// that may have added a backup_ids column out-of-band.

const ID_COLUMNS_BEFORE = [
  'firewall_ids', 'edr_ids', 'siem_ids', 'idp_ids', 'mfa_ids', 'pam_ids',
  'email_security_ids', 'mdr_ids', 'msp_ids', 'sase_ids', 'sdwan_ids',
  'vpn_ids', 'dlp_ids', 'casb_ids', 'vuln_mgmt_ids', 'ticketing_ids',
  'email_collab_ids', 'cloud_provider_ids',
];

exports.up = (pgm) => {
  // ─── 1. Rename email_collab_ids → productivity_suite_ids ────────────
  pgm.sql(`
    ALTER TABLE account_details RENAME COLUMN email_collab_ids TO productivity_suite_ids;
  `);

  // ─── 2. Add the four new array columns + GIN indexes ────────────────
  pgm.sql(`
    ALTER TABLE account_details
      ADD COLUMN cspm_ids   BIGINT[] NOT NULL DEFAULT '{}',
      ADD COLUMN appsec_ids BIGINT[] NOT NULL DEFAULT '{}',
      ADD COLUMN ndr_ids    BIGINT[] NOT NULL DEFAULT '{}',
      ADD COLUMN iot_ot_ids BIGINT[] NOT NULL DEFAULT '{}';

    CREATE INDEX idx_account_details_cspm_ids               ON account_details USING GIN (cspm_ids);
    CREATE INDEX idx_account_details_appsec_ids             ON account_details USING GIN (appsec_ids);
    CREATE INDEX idx_account_details_ndr_ids                ON account_details USING GIN (ndr_ids);
    CREATE INDEX idx_account_details_iot_ot_ids             ON account_details USING GIN (iot_ot_ids);
    CREATE INDEX idx_account_details_productivity_suite_ids ON account_details USING GIN (productivity_suite_ids);
  `);

  // ─── 3. Repoint vendor_products.category=email_collab → productivity_suite
  pgm.sql(`
    UPDATE vendor_products SET category = 'productivity_suite' WHERE category = 'email_collab';
  `);

  // ─── 4. Scrub any backup product IDs from every account_details array,
  // then drop the products + their now-unused vendors.
  const scrubSql = ID_COLUMNS_BEFORE
    .filter((c) => c !== 'email_collab_ids') // already renamed above
    .concat(['productivity_suite_ids', 'cspm_ids', 'appsec_ids', 'ndr_ids', 'iot_ot_ids'])
    .map((col) => `
      UPDATE account_details SET ${col} = COALESCE(
        (SELECT array_agg(id) FROM unnest(${col}) AS id
         WHERE id NOT IN (SELECT id FROM vendor_products WHERE category = 'backup')),
        '{}'::bigint[]
      )
      WHERE ${col} && (
        SELECT COALESCE(array_agg(id), '{}'::bigint[]) FROM vendor_products WHERE category = 'backup'
      );
    `).join('\n');

  pgm.sql(scrubSql);

  pgm.sql(`
    DELETE FROM vendor_products WHERE category = 'backup';
    DELETE FROM vendors v
    WHERE v.slug IN ('veeam', 'rubrik', 'cohesity')
      AND NOT EXISTS (SELECT 1 FROM vendor_products vp WHERE vp.vendor_id = v.id);
  `);
};

exports.down = (pgm) => {
  // Reverse the rename and drop the added columns. Data in the four new
  // columns is lost on rollback (no equivalent old shape to restore to). The
  // backup products/vendors are NOT recreated — the seed migration would
  // need to re-add them, which is out of scope for this rollback.
  pgm.sql(`
    DROP INDEX IF EXISTS idx_account_details_productivity_suite_ids;
    DROP INDEX IF EXISTS idx_account_details_iot_ot_ids;
    DROP INDEX IF EXISTS idx_account_details_ndr_ids;
    DROP INDEX IF EXISTS idx_account_details_appsec_ids;
    DROP INDEX IF EXISTS idx_account_details_cspm_ids;

    ALTER TABLE account_details
      DROP COLUMN iot_ot_ids,
      DROP COLUMN ndr_ids,
      DROP COLUMN appsec_ids,
      DROP COLUMN cspm_ids;

    ALTER TABLE account_details RENAME COLUMN productivity_suite_ids TO email_collab_ids;

    UPDATE vendor_products SET category = 'email_collab' WHERE category = 'productivity_suite';
  `);
};
