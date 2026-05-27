// Events table — public/global data scraped from external sources (currently
// Palo Alto Networks' event calendar). Same row visible to every user, so this
// table intentionally has NO user_id and NO row-level security. Per-user data
// (e.g. "events near my contacts") comes from joining events to the existing
// per-user contacts table at query time.
//
// Designed for future public exposure: nothing in the row is user-scoped, the
// (source, source_id) pair is the stable external identity, and the upsert
// path is idempotent so re-scraping the same source updates rather than dupes.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE events (
      id            BIGSERIAL PRIMARY KEY,
      source        TEXT NOT NULL,
      source_id     TEXT NOT NULL,
      title         TEXT NOT NULL,
      summary       TEXT,
      start_date    DATE,
      end_date      DATE,
      mode          TEXT CHECK (mode IS NULL OR mode IN ('in_person', 'virtual', 'hybrid', 'on_demand')),
      location_raw  TEXT,
      city          TEXT,
      state         TEXT,
      country       TEXT,
      venue         TEXT,
      url           TEXT,
      tags          JSONB NOT NULL DEFAULT '[]'::jsonb,
      scraped_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (source, source_id)
    );

    CREATE INDEX idx_events_city       ON events (LOWER(city));
    CREATE INDEX idx_events_country    ON events (LOWER(country));
    CREATE INDEX idx_events_mode       ON events (mode);
    CREATE INDEX idx_events_start_date ON events (start_date);

    CREATE TRIGGER events_updated_at BEFORE UPDATE ON events
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS events_updated_at ON events;
    DROP TABLE IF EXISTS events;
  `);
};
