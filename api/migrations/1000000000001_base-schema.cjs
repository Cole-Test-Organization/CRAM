exports.up = (pgm) => {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    CREATE TABLE accounts (
      id                   BIGSERIAL PRIMARY KEY,
      slug                 TEXT NOT NULL UNIQUE,
      name                 TEXT NOT NULL,
      status               TEXT,
      last_contact         DATE,
      channel_partners     JSONB,
      pa_team              JSONB,
      relationship_summary TEXT,
      environment          JSONB,
      open_threads         JSONB,
      active_deals         TEXT,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      search_vector        tsvector GENERATED ALWAYS AS (
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
      ) STORED
    );
    CREATE INDEX idx_accounts_search ON accounts USING GIN (search_vector);
    CREATE INDEX idx_accounts_slug ON accounts(slug);
    CREATE INDEX idx_accounts_status ON accounts(status);
    CREATE INDEX idx_accounts_last_contact ON accounts(last_contact);
    CREATE TRIGGER accounts_updated_at BEFORE UPDATE ON accounts
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  pgm.sql(`
    CREATE TABLE contacts (
      id            BIGSERIAL PRIMARY KEY,
      full_name     TEXT NOT NULL,
      company       TEXT,
      title         TEXT,
      email         TEXT,
      phone         TEXT,
      linkedin      TEXT,
      notes         TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('english',
          coalesce(full_name, '') || ' ' ||
          coalesce(company, '') || ' ' ||
          coalesce(title, '') || ' ' ||
          coalesce(email, '') || ' ' ||
          coalesce(notes, '')
        )
      ) STORED
    );
    CREATE INDEX idx_contacts_search ON contacts USING GIN (search_vector);
    CREATE INDEX idx_contacts_email ON contacts(email);
    CREATE INDEX idx_contacts_name ON contacts(full_name);
    CREATE TRIGGER contacts_updated_at BEFORE UPDATE ON contacts
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  pgm.sql(`
    CREATE TABLE account_contacts (
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      contact_id BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      PRIMARY KEY (account_id, contact_id)
    );
    CREATE INDEX idx_ac_contact ON account_contacts(contact_id);
  `);

  pgm.sql(`
    CREATE TABLE meetings (
      id            BIGSERIAL PRIMARY KEY,
      account_id    BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      date          DATE NOT NULL,
      title         TEXT,
      filename      TEXT NOT NULL,
      attendees     TEXT,
      body          TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('english',
          coalesce(title, '') || ' ' ||
          coalesce(attendees, '') || ' ' ||
          coalesce(body, '')
        )
      ) STORED,
      UNIQUE(account_id, filename)
    );
    CREATE INDEX idx_meetings_search ON meetings USING GIN (search_vector);
    CREATE INDEX idx_meetings_account ON meetings(account_id);
    CREATE INDEX idx_meetings_date ON meetings(date);
    CREATE TRIGGER meetings_updated_at BEFORE UPDATE ON meetings
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  pgm.sql(`
    CREATE TABLE meeting_attendees (
      meeting_id BIGINT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      contact_id BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      PRIMARY KEY (meeting_id, contact_id)
    );
    CREATE INDEX idx_ma_contact ON meeting_attendees(contact_id);
  `);

  pgm.sql(`
    CREATE TABLE internal_notes (
      id            BIGSERIAL PRIMARY KEY,
      date          DATE NOT NULL,
      title         TEXT,
      filename      TEXT NOT NULL UNIQUE,
      attendees     TEXT,
      body          TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('english',
          coalesce(title, '') || ' ' ||
          coalesce(attendees, '') || ' ' ||
          coalesce(body, '')
        )
      ) STORED
    );
    CREATE INDEX idx_internal_search ON internal_notes USING GIN (search_vector);
    CREATE INDEX idx_internal_date ON internal_notes(date);
    CREATE TRIGGER internal_notes_updated_at BEFORE UPDATE ON internal_notes
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS meeting_attendees;
    DROP TABLE IF EXISTS internal_notes;
    DROP TABLE IF EXISTS meetings;
    DROP TABLE IF EXISTS account_contacts;
    DROP TABLE IF EXISTS contacts;
    DROP TABLE IF EXISTS accounts;
    DROP FUNCTION IF EXISTS set_updated_at();
  `);
};
