exports.up = (pgm) => {
  // 1. Schema changes on meetings.
  pgm.sql(`
    ALTER TABLE meetings ADD COLUMN internal BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE meetings ALTER COLUMN account_id DROP NOT NULL;

    ALTER TABLE meetings DROP CONSTRAINT meetings_account_id_filename_key;

    CREATE UNIQUE INDEX meetings_account_filename_uniq
      ON meetings (account_id, filename)
      WHERE account_id IS NOT NULL;

    CREATE UNIQUE INDEX meetings_internal_filename_uniq
      ON meetings (user_id, filename)
      WHERE account_id IS NULL;

    CREATE INDEX idx_meetings_internal ON meetings(internal) WHERE internal = true;
  `);

  // 2. Lift FORCE RLS so the backfill (running as DB owner) can move rows.
  pgm.sql(`
    ALTER TABLE meetings                NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE meeting_attendees       NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE internal_notes          NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE internal_note_attendees NO FORCE ROW LEVEL SECURITY;
  `);

  // 3. Copy internal_notes into meetings (internal=true, account_id=NULL),
  //    keeping a temp map old_id → new_id to move attendees next.
  pgm.sql(`
    CREATE TEMP TABLE _internal_id_map (
      old_id BIGINT PRIMARY KEY,
      new_id BIGINT NOT NULL
    );

    WITH inserted AS (
      INSERT INTO meetings
        (user_id, account_id, date, title, filename, attendees, body, internal, created_at, updated_at)
      SELECT user_id, NULL::bigint, date, title, filename, attendees, body, true, created_at, updated_at
      FROM internal_notes
      ORDER BY id
      RETURNING id AS new_id, user_id, filename
    )
    INSERT INTO _internal_id_map (old_id, new_id)
    SELECT i.id, ins.new_id
    FROM internal_notes i
    JOIN inserted ins ON ins.user_id = i.user_id AND ins.filename = i.filename;
  `);

  // 4. Move attendee links via the temp map.
  pgm.sql(`
    INSERT INTO meeting_attendees (meeting_id, contact_id)
    SELECT m.new_id, a.contact_id
    FROM internal_note_attendees a
    JOIN _internal_id_map m ON m.old_id = a.internal_note_id
    ON CONFLICT DO NOTHING;
  `);

  // 5. Drop the old internal_* tables (drops policies, indexes, FTS triggers with them).
  pgm.sql(`
    DROP TABLE internal_note_attendees;
    DROP TABLE internal_notes;
  `);

  // 6. Restore FORCE RLS.
  pgm.sql(`
    ALTER TABLE meetings          FORCE ROW LEVEL SECURITY;
    ALTER TABLE meeting_attendees FORCE ROW LEVEL SECURITY;
  `);
};

exports.down = (pgm) => {
  // Best-effort rollback: recreate internal_notes + internal_note_attendees,
  // then move internal=true meetings (and their attendees) back.
  pgm.sql(`
    CREATE TABLE internal_notes (
      id            BIGSERIAL PRIMARY KEY,
      user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date          DATE NOT NULL,
      title         TEXT,
      filename      TEXT NOT NULL,
      attendees     TEXT,
      body          TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('english',
          coalesce(title, '') || ' ' || coalesce(attendees, '') || ' ' || coalesce(body, '')
        )
      ) STORED,
      CONSTRAINT internal_notes_user_filename_key UNIQUE (user_id, filename)
    );
    CREATE INDEX idx_internal_search ON internal_notes USING GIN (search_vector);
    CREATE INDEX idx_internal_date   ON internal_notes(date);
    CREATE INDEX idx_internal_user   ON internal_notes(user_id);
    CREATE TRIGGER internal_notes_updated_at BEFORE UPDATE ON internal_notes
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    ALTER TABLE internal_notes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE internal_notes FORCE  ROW LEVEL SECURITY;
    CREATE POLICY internal_notes_isolation ON internal_notes
      FOR ALL
      USING      (user_id = current_setting('app.current_user_id', true)::bigint)
      WITH CHECK (user_id = current_setting('app.current_user_id', true)::bigint);

    CREATE TABLE internal_note_attendees (
      internal_note_id BIGINT NOT NULL REFERENCES internal_notes(id) ON DELETE CASCADE,
      contact_id       BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      PRIMARY KEY (internal_note_id, contact_id)
    );
    CREATE INDEX idx_ina_contact ON internal_note_attendees(contact_id);
    ALTER TABLE internal_note_attendees ENABLE ROW LEVEL SECURITY;
    ALTER TABLE internal_note_attendees FORCE  ROW LEVEL SECURITY;
    CREATE POLICY internal_note_attendees_isolation ON internal_note_attendees
      FOR ALL
      USING (
        EXISTS (SELECT 1 FROM internal_notes n WHERE n.id = internal_note_attendees.internal_note_id)
      )
      WITH CHECK (
        EXISTS (SELECT 1 FROM internal_notes n WHERE n.id = internal_note_attendees.internal_note_id)
        AND EXISTS (SELECT 1 FROM contacts c WHERE c.id = internal_note_attendees.contact_id)
      );
  `);

  pgm.sql(`
    ALTER TABLE meetings                NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE meeting_attendees       NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE internal_notes          NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE internal_note_attendees NO FORCE ROW LEVEL SECURITY;
  `);

  pgm.sql(`
    CREATE TEMP TABLE _back_id_map (old_id BIGINT PRIMARY KEY, new_id BIGINT NOT NULL);

    WITH inserted AS (
      INSERT INTO internal_notes (user_id, date, title, filename, attendees, body, created_at, updated_at)
      SELECT user_id, date, title, filename, attendees, body, created_at, updated_at
      FROM meetings WHERE internal = true
      ORDER BY id
      RETURNING id AS new_id, user_id, filename
    )
    INSERT INTO _back_id_map (old_id, new_id)
    SELECT m.id, ins.new_id
    FROM meetings m
    JOIN inserted ins ON ins.user_id = m.user_id AND ins.filename = m.filename
    WHERE m.internal = true;

    INSERT INTO internal_note_attendees (internal_note_id, contact_id)
    SELECT b.new_id, a.contact_id
    FROM meeting_attendees a
    JOIN _back_id_map b ON b.old_id = a.meeting_id
    ON CONFLICT DO NOTHING;

    DELETE FROM meetings WHERE internal = true;
  `);

  pgm.sql(`
    ALTER TABLE meetings          FORCE ROW LEVEL SECURITY;
    ALTER TABLE meeting_attendees FORCE ROW LEVEL SECURITY;

    DROP INDEX IF EXISTS idx_meetings_internal;
    DROP INDEX IF EXISTS meetings_internal_filename_uniq;
    DROP INDEX IF EXISTS meetings_account_filename_uniq;

    ALTER TABLE meetings ALTER COLUMN account_id SET NOT NULL;
    ALTER TABLE meetings ADD CONSTRAINT meetings_account_id_filename_key UNIQUE (account_id, filename);
    ALTER TABLE meetings DROP COLUMN internal;
  `);
};
