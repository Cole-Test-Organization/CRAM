exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE accounts DROP COLUMN search_vector;
    ALTER TABLE accounts ADD COLUMN domains JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE accounts ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
      to_tsvector('english',
        coalesce(slug, '') || ' ' ||
        coalesce(name, '') || ' ' ||
        coalesce(status, '') || ' ' ||
        coalesce(relationship_summary, '') || ' ' ||
        coalesce(environment::text, '') || ' ' ||
        coalesce(open_threads::text, '') || ' ' ||
        coalesce(channel_partners::text, '') || ' ' ||
        coalesce(pa_team::text, '') || ' ' ||
        coalesce(domains::text, '')
      )
    ) STORED;
    CREATE INDEX idx_accounts_search ON accounts USING GIN (search_vector);
    CREATE INDEX idx_accounts_domains ON accounts USING GIN (domains jsonb_path_ops);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_accounts_domains;
    ALTER TABLE accounts DROP COLUMN search_vector;
    ALTER TABLE accounts DROP COLUMN domains;
    ALTER TABLE accounts ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
      to_tsvector('english',
        coalesce(slug, '') || ' ' ||
        coalesce(name, '') || ' ' ||
        coalesce(status, '') || ' ' ||
        coalesce(relationship_summary, '') || ' ' ||
        coalesce(environment::text, '') || ' ' ||
        coalesce(open_threads::text, '') || ' ' ||
        coalesce(channel_partners::text, '') || ' ' ||
        coalesce(pa_team::text, '')
      )
    ) STORED;
    CREATE INDEX idx_accounts_search ON accounts USING GIN (search_vector);
  `);
};
