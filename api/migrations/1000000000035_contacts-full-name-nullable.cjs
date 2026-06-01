// contacts.full_name — relax NOT NULL so a contact can exist with only an
// email. Calendar/agent ingestion routinely sees an address before it ever
// sees a name (e.g. jsmith@acme.com with no display name on the invite). We
// now store that as an email-only contact and fill the name in later via
// findOrCreate's blank-only enrich, instead of fabricating a name from the
// email local-part. Safe downstream: the btree + trigram name indexes tolerate
// NULLs, search_vector COALESCEs full_name to '', and every name-based match
// tier already guards on a non-empty name.

exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE contacts ALTER COLUMN full_name DROP NOT NULL;`);
};

exports.down = (pgm) => {
  // Will fail if any email-only contacts exist (NULL full_name). Backfill or
  // delete those rows before rolling back.
  pgm.sql(`ALTER TABLE contacts ALTER COLUMN full_name SET NOT NULL;`);
};
