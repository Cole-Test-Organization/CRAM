// Enable pg_trgm so vendor_products and vendors findOrCreate can fuzzy-match
// candidate names against existing rows (catches "Meraki" vs "Meraki MX",
// "Cisco" vs "Cisco Meraki", "CyberArk Identity" vs "Identity", etc.). The
// services layer drives the similarity() comparison; this migration just
// makes the extension available and adds trigram indexes so the per-vendor
// scan stays cheap as the catalog grows.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE EXTENSION IF NOT EXISTS pg_trgm;

    CREATE INDEX idx_vendor_products_name_trgm
      ON vendor_products USING GIN (lower(name) gin_trgm_ops);

    CREATE INDEX idx_vendors_name_trgm
      ON vendors USING GIN (lower(name) gin_trgm_ops);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_vendor_products_name_trgm;
    DROP INDEX IF EXISTS idx_vendors_name_trgm;
    -- Leave the extension installed; other code may depend on it later.
  `);
};
