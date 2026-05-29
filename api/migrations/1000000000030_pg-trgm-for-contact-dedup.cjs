// Trigram index for contacts.findOrCreate fuzzy matching. pg_trgm is already
// installed (see 1000000000029_pg-trgm-for-vendor-dedup); this just adds a GIN
// trigram index on the contact name so the per-user similarity scan stays cheap
// and the `%` operator can prefilter candidates via the index. We fuzzy-match on
// full_name only — email remains an exact key — and at a higher similarity
// threshold than the vendor catalog, since merging two different people is
// costly. The services layer drives the similarity() comparison.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE EXTENSION IF NOT EXISTS pg_trgm;

    CREATE INDEX idx_contacts_full_name_trgm
      ON contacts USING GIN (lower(full_name) gin_trgm_ops);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_contacts_full_name_trgm;
  `);
};
