// Import-triage support. Three independent schema moves that together let the
// notes-import pipeline (and the in-app agent) CREATE records they can't yet
// confidently ASSIGN, and park them for one-click triage instead of dropping
// them or spawning junk:
//
//   1. meeting_attendees can now hold UNLINKED attendees — a name (and maybe an
//      email) with no contact row yet. Bulk import records who was in the room
//      for visibility without creating a contact per attendee; the user (or a
//      later high-confidence match) links them afterwards.
//   2. meetings gets a `needs_review` flag — separates "parked, unmatched note,
//      please assign an account" from "deliberate internal note, leave alone".
//      Both are account_id IS NULL; the flag is what keeps the triage queue from
//      becoming a graveyard. Mirrors vendor_products.needs_review.
//   3. accounts gets a trigram index so accounts.findOrCreate can fuzzy-match on
//      name (it already matches slug + domains exactly). pg_trgm is already
//      installed (1000000000029).
//
// Also retires the free-text meetings.attendees column: structured
// meeting_attendees rows (linked OR unlinked display_name) are now the single
// source of truth for who attended. Existing free-text is best-effort backfilled
// into unlinked rows so no names are lost before the column is dropped.

exports.up = (pgm) => {
  // 1. meetings.needs_review (triage flag) ────────────────────────────────
  pgm.sql(`
    ALTER TABLE meetings ADD COLUMN needs_review BOOLEAN NOT NULL DEFAULT false;
    CREATE INDEX idx_meetings_needs_review ON meetings (needs_review) WHERE needs_review = true;
  `);

  // 2. meeting_attendees: allow unlinked attendees ────────────────────────
  //    Swap the (meeting_id, contact_id) composite PK for a surrogate id so
  //    contact_id can go nullable; a row identifies someone by EITHER a linked
  //    contact OR a display_name. Keep "no duplicate link to the same contact"
  //    via a partial unique index.
  pgm.sql(`
    ALTER TABLE meeting_attendees DROP CONSTRAINT meeting_attendees_pkey;
    ALTER TABLE meeting_attendees ADD COLUMN id BIGSERIAL PRIMARY KEY;
    ALTER TABLE meeting_attendees ALTER COLUMN contact_id DROP NOT NULL;
    ALTER TABLE meeting_attendees ADD COLUMN display_name TEXT;
    ALTER TABLE meeting_attendees ADD COLUMN email TEXT;
    ALTER TABLE meeting_attendees ADD CONSTRAINT meeting_attendees_identity_chk
      CHECK (contact_id IS NOT NULL OR display_name IS NOT NULL);
    CREATE UNIQUE INDEX meeting_attendees_linked_uniq
      ON meeting_attendees (meeting_id, contact_id) WHERE contact_id IS NOT NULL;
    CREATE INDEX idx_ma_unlinked
      ON meeting_attendees (meeting_id) WHERE contact_id IS NULL;
  `);

  //    RLS: the old WITH CHECK required EXISTS(contact), which would reject an
  //    unlinked (contact_id IS NULL) row. Permit a null contact; still require
  //    the row's meeting to be visible, and a non-null contact to exist.
  pgm.sql(`
    DROP POLICY meeting_attendees_isolation ON meeting_attendees;
    CREATE POLICY meeting_attendees_isolation ON meeting_attendees
      FOR ALL
      USING (
        EXISTS (SELECT 1 FROM meetings m WHERE m.id = meeting_attendees.meeting_id)
      )
      WITH CHECK (
        EXISTS (SELECT 1 FROM meetings m WHERE m.id = meeting_attendees.meeting_id)
        AND (
          contact_id IS NULL
          OR EXISTS (SELECT 1 FROM contacts c WHERE c.id = meeting_attendees.contact_id)
        )
      );
  `);

  // 3. Backfill free-text attendees → unlinked rows, then drop the column ──
  //    Lift FORCE RLS so the owner-run backfill can write across every user's
  //    meetings (app.current_user_id isn't set in a migration), like 1...008.
  pgm.sql(`
    ALTER TABLE meetings          NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE meeting_attendees NO FORCE ROW LEVEL SECURITY;
  `);

  //    Split on , or ; (best-effort — the column was unstructured), skip blanks,
  //    and skip any token already represented by a linked attendee's contact
  //    name on that meeting so we don't double-list someone.
  pgm.sql(`
    INSERT INTO meeting_attendees (meeting_id, contact_id, display_name)
    SELECT m.id, NULL::bigint, t.name
    FROM meetings m
    CROSS JOIN LATERAL (
      SELECT DISTINCT trim(tok) AS name
      FROM regexp_split_to_table(m.attendees, '[,;]') AS tok
      WHERE trim(tok) <> ''
    ) t
    WHERE m.attendees IS NOT NULL AND trim(m.attendees) <> ''
      AND NOT EXISTS (
        SELECT 1 FROM meeting_attendees ma
        JOIN contacts c ON c.id = ma.contact_id
        WHERE ma.meeting_id = m.id AND lower(c.full_name) = lower(t.name)
      );
  `);

  pgm.sql(`
    ALTER TABLE meetings          FORCE ROW LEVEL SECURITY;
    ALTER TABLE meeting_attendees FORCE ROW LEVEL SECURITY;
  `);

  //    search_vector is GENERATED, so its expression can't be altered in place —
  //    drop it (and its GIN index), drop attendees, re-add both without it.
  pgm.sql(`
    DROP INDEX IF EXISTS idx_meetings_search;
    ALTER TABLE meetings DROP COLUMN search_vector;
    ALTER TABLE meetings DROP COLUMN attendees;
    ALTER TABLE meetings ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
      to_tsvector('english',
        coalesce(title, '') || ' ' || coalesce(body, '')
      )
    ) STORED;
    CREATE INDEX idx_meetings_search ON meetings USING GIN (search_vector);
  `);

  // 4. accounts trigram index for fuzzy name matching in findOrCreate ──────
  pgm.sql(`
    CREATE INDEX idx_accounts_name_trgm
      ON accounts USING GIN (lower(name) gin_trgm_ops);
  `);
};

exports.down = (pgm) => {
  // Best-effort rollback. The original free-text attendees content is NOT
  // restored (it was retired); the column comes back empty.
  pgm.sql(`DROP INDEX IF EXISTS idx_accounts_name_trgm;`);

  // meetings: restore attendees column + its search_vector, drop needs_review.
  pgm.sql(`
    DROP INDEX IF EXISTS idx_meetings_search;
    ALTER TABLE meetings DROP COLUMN search_vector;
    ALTER TABLE meetings ADD COLUMN attendees TEXT;
    ALTER TABLE meetings ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
      to_tsvector('english',
        coalesce(title, '') || ' ' || coalesce(attendees, '') || ' ' || coalesce(body, '')
      )
    ) STORED;
    CREATE INDEX idx_meetings_search ON meetings USING GIN (search_vector);

    DROP INDEX IF EXISTS idx_meetings_needs_review;
    ALTER TABLE meetings DROP COLUMN needs_review;
  `);

  // meeting_attendees: drop unlinked rows (the old schema can't hold them),
  // restore the composite PK and the original RLS policy.
  pgm.sql(`
    DELETE FROM meeting_attendees WHERE contact_id IS NULL;

    DROP INDEX IF EXISTS idx_ma_unlinked;
    DROP INDEX IF EXISTS meeting_attendees_linked_uniq;
    ALTER TABLE meeting_attendees DROP CONSTRAINT meeting_attendees_identity_chk;
    ALTER TABLE meeting_attendees DROP COLUMN display_name;
    ALTER TABLE meeting_attendees DROP COLUMN email;
    ALTER TABLE meeting_attendees ALTER COLUMN contact_id SET NOT NULL;
    ALTER TABLE meeting_attendees DROP CONSTRAINT meeting_attendees_pkey;
    ALTER TABLE meeting_attendees DROP COLUMN id;
    ALTER TABLE meeting_attendees ADD PRIMARY KEY (meeting_id, contact_id);
  `);

  pgm.sql(`
    DROP POLICY meeting_attendees_isolation ON meeting_attendees;
    CREATE POLICY meeting_attendees_isolation ON meeting_attendees
      FOR ALL
      USING (
        EXISTS (SELECT 1 FROM meetings m WHERE m.id = meeting_attendees.meeting_id)
      )
      WITH CHECK (
        EXISTS (SELECT 1 FROM meetings m WHERE m.id = meeting_attendees.meeting_id)
        AND EXISTS (SELECT 1 FROM contacts c WHERE c.id = meeting_attendees.contact_id)
      );
  `);
};
