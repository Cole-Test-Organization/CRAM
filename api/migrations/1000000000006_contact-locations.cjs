exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE contacts
      ADD COLUMN location_raw TEXT,
      ADD COLUMN city         TEXT,
      ADD COLUMN state        TEXT,
      ADD COLUMN country      TEXT;

    CREATE INDEX idx_contacts_city    ON contacts(LOWER(city));
    CREATE INDEX idx_contacts_country ON contacts(LOWER(country));
  `);

  // Rebuild search_vector so location is searchable.
  pgm.sql(`
    ALTER TABLE contacts DROP COLUMN search_vector;
    ALTER TABLE contacts ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
      to_tsvector('english',
        coalesce(full_name, '') || ' ' ||
        coalesce(company, '') || ' ' ||
        coalesce(title, '') || ' ' ||
        coalesce(email, '') || ' ' ||
        coalesce(notes, '') || ' ' ||
        coalesce(location_raw, '') || ' ' ||
        coalesce(city, '') || ' ' ||
        coalesce(state, '') || ' ' ||
        coalesce(country, '')
      )
    ) STORED;
    CREATE INDEX idx_contacts_search ON contacts USING GIN (search_vector);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE contacts DROP COLUMN search_vector;
    ALTER TABLE contacts ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
      to_tsvector('english',
        coalesce(full_name, '') || ' ' ||
        coalesce(company, '') || ' ' ||
        coalesce(title, '') || ' ' ||
        coalesce(email, '') || ' ' ||
        coalesce(notes, '')
      )
    ) STORED;
    CREATE INDEX idx_contacts_search ON contacts USING GIN (search_vector);

    DROP INDEX IF EXISTS idx_contacts_country;
    DROP INDEX IF EXISTS idx_contacts_city;
    ALTER TABLE contacts
      DROP COLUMN country,
      DROP COLUMN state,
      DROP COLUMN city,
      DROP COLUMN location_raw;
  `);
};
