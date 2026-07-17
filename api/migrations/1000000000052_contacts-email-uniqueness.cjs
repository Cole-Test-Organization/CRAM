// A contact's normalized email is a strong identity within one user's CRM.
// Keep email nullable (name-only contacts are valid), but guarantee that two
// rows owned by the same user cannot carry the same non-null address.
//
// Existing exact-email duplicates must be consolidated before the unique index
// can be created. The oldest row wins, matching the service's existing
// `ORDER BY id LIMIT 1` email lookup. Blank profile fields are filled from the
// duplicate, distinct notes are appended, and every contact relationship is
// repointed before the redundant row is removed.

exports.up = (pgm) => {
  pgm.sql(`
    -- Migrations run without app.current_user_id. Let the table owner perform
    -- this one-time, cross-user consolidation; RLS remains enabled throughout.
    ALTER TABLE contacts                  NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE account_contacts          NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE account_contact_reporting NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE meeting_attendees         NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE notes                     NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE tasks                     NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE thread_contacts           NO FORCE ROW LEVEL SECURITY;

    -- Empty/whitespace-only email means "unknown". All real addresses use the
    -- same lowercase + trim representation the API uses for matching.
    UPDATE contacts
       SET email = NULLIF(lower(btrim(email)), '')
     WHERE email IS DISTINCT FROM NULLIF(lower(btrim(email)), '');

    CREATE TEMP TABLE contact_reporting_merge_buffer (
      account_id            BIGINT NOT NULL,
      contact_id            BIGINT NOT NULL,
      reports_to_contact_id BIGINT NOT NULL,
      created_at            TIMESTAMPTZ NOT NULL,
      updated_at            TIMESTAMPTZ NOT NULL
    ) ON COMMIT DROP;

    DO $dedupe$
    DECLARE
      duplicate_row RECORD;
      merged_count  INTEGER := 0;
    BEGIN
      -- The cursor is based on the pre-merge snapshot. For each normalized
      -- (user_id, email), every row after the oldest is folded into that winner.
      FOR duplicate_row IN
        SELECT id AS loser_id,
               min(id) OVER (PARTITION BY user_id, email) AS winner_id
          FROM contacts
         WHERE email IS NOT NULL
         ORDER BY user_id, email, id
      LOOP
        IF duplicate_row.loser_id = duplicate_row.winner_id THEN
          CONTINUE;
        END IF;

        -- Preserve the winner's curated values and only fill its blanks. Notes
        -- are the exception: distinct nonblank notes from both rows are kept.
        UPDATE contacts AS winner
           SET full_name = CASE
                 WHEN NULLIF(btrim(winner.full_name), '') IS NULL
                   THEN NULLIF(btrim(loser.full_name), '')
                 ELSE winner.full_name
               END,
               company = CASE
                 WHEN NULLIF(btrim(winner.company), '') IS NULL
                   THEN NULLIF(btrim(loser.company), '')
                 ELSE winner.company
               END,
               title = CASE
                 WHEN NULLIF(btrim(winner.title), '') IS NULL
                   THEN NULLIF(btrim(loser.title), '')
                 ELSE winner.title
               END,
               phone = CASE
                 WHEN NULLIF(btrim(winner.phone), '') IS NULL
                   THEN NULLIF(btrim(loser.phone), '')
                 ELSE winner.phone
               END,
               linkedin = CASE
                 WHEN NULLIF(btrim(winner.linkedin), '') IS NULL
                   THEN NULLIF(btrim(loser.linkedin), '')
                 ELSE winner.linkedin
               END,
               notes = CASE
                 WHEN NULLIF(btrim(winner.notes), '') IS NULL THEN loser.notes
                 WHEN NULLIF(btrim(loser.notes), '') IS NULL THEN winner.notes
                 WHEN btrim(winner.notes) = btrim(loser.notes) THEN winner.notes
                 ELSE winner.notes || E'\n\n---\n\n' || loser.notes
               END,
               location_raw = CASE
                 WHEN NULLIF(btrim(winner.location_raw), '') IS NULL
                   THEN NULLIF(btrim(loser.location_raw), '')
                 ELSE winner.location_raw
               END,
               city = CASE
                 WHEN NULLIF(btrim(winner.city), '') IS NULL
                   THEN NULLIF(btrim(loser.city), '')
                 ELSE winner.city
               END,
               state = CASE
                 WHEN NULLIF(btrim(winner.state), '') IS NULL
                   THEN NULLIF(btrim(loser.state), '')
                 ELSE winner.state
               END,
               country = CASE
                 WHEN NULLIF(btrim(winner.country), '') IS NULL
                   THEN NULLIF(btrim(loser.country), '')
                 ELSE winner.country
               END
          FROM contacts AS loser
         WHERE winner.id = duplicate_row.winner_id
           AND loser.id = duplicate_row.loser_id;

        -- A reporting edge references account_contacts twice, so make every
        -- loser account membership available to the winner before remapping it.
        INSERT INTO account_contacts (account_id, contact_id)
        SELECT account_id, duplicate_row.winner_id
          FROM account_contacts
         WHERE contact_id = duplicate_row.loser_id
        ON CONFLICT DO NOTHING;

        TRUNCATE contact_reporting_merge_buffer;
        INSERT INTO contact_reporting_merge_buffer (
          account_id, contact_id, reports_to_contact_id, created_at, updated_at
        )
        SELECT DISTINCT ON (mapped.account_id, mapped.contact_id)
               mapped.account_id,
               mapped.contact_id,
               mapped.reports_to_contact_id,
               mapped.created_at,
               mapped.updated_at
          FROM (
            SELECT acr.account_id,
                   CASE WHEN acr.contact_id = duplicate_row.loser_id
                        THEN duplicate_row.winner_id ELSE acr.contact_id END AS contact_id,
                   CASE WHEN acr.reports_to_contact_id = duplicate_row.loser_id
                        THEN duplicate_row.winner_id ELSE acr.reports_to_contact_id END AS reports_to_contact_id,
                   acr.created_at,
                   acr.updated_at,
                   (acr.contact_id = duplicate_row.winner_id) AS winner_edge
              FROM account_contact_reporting acr
             WHERE acr.contact_id = duplicate_row.loser_id
                OR acr.reports_to_contact_id = duplicate_row.loser_id
          ) AS mapped
         WHERE mapped.contact_id <> mapped.reports_to_contact_id
         ORDER BY mapped.account_id, mapped.contact_id,
                  mapped.winner_edge DESC, mapped.created_at, mapped.reports_to_contact_id;

        DELETE FROM account_contact_reporting
         WHERE contact_id = duplicate_row.loser_id
            OR reports_to_contact_id = duplicate_row.loser_id;

        INSERT INTO account_contact_reporting (
          account_id, contact_id, reports_to_contact_id, created_at, updated_at
        )
        SELECT account_id, contact_id, reports_to_contact_id, created_at, updated_at
          FROM contact_reporting_merge_buffer
        ON CONFLICT (account_id, contact_id) DO NOTHING;

        DELETE FROM account_contacts
         WHERE contact_id = duplicate_row.loser_id;

        -- Preserve one attendee row per (meeting, person), preferring the
        -- winner's existing status when both contacts were linked to a meeting.
        UPDATE meeting_attendees AS winner_attendee
           SET status = COALESCE(winner_attendee.status, loser_attendee.status)
          FROM meeting_attendees AS loser_attendee
         WHERE loser_attendee.contact_id = duplicate_row.loser_id
           AND winner_attendee.contact_id = duplicate_row.winner_id
           AND winner_attendee.meeting_id = loser_attendee.meeting_id;

        DELETE FROM meeting_attendees AS loser_attendee
         USING meeting_attendees AS winner_attendee
         WHERE loser_attendee.contact_id = duplicate_row.loser_id
           AND winner_attendee.contact_id = duplicate_row.winner_id
           AND winner_attendee.meeting_id = loser_attendee.meeting_id;

        UPDATE meeting_attendees
           SET contact_id = duplicate_row.winner_id
         WHERE contact_id = duplicate_row.loser_id;

        UPDATE notes
           SET contact_id = duplicate_row.winner_id
         WHERE contact_id = duplicate_row.loser_id;

        UPDATE tasks
           SET assignee_contact_id = duplicate_row.winner_id
         WHERE assignee_contact_id = duplicate_row.loser_id;

        INSERT INTO thread_contacts (thread_id, contact_id)
        SELECT thread_id, duplicate_row.winner_id
          FROM thread_contacts
         WHERE contact_id = duplicate_row.loser_id
        ON CONFLICT DO NOTHING;

        DELETE FROM thread_contacts
         WHERE contact_id = duplicate_row.loser_id;

        DELETE FROM contacts
         WHERE id = duplicate_row.loser_id;

        merged_count := merged_count + 1;
      END LOOP;

      RAISE NOTICE 'Consolidated % duplicate contact row(s) by normalized email', merged_count;
    END
    $dedupe$;

    DROP INDEX IF EXISTS idx_contacts_email;

    ALTER TABLE contacts
      ADD CONSTRAINT contacts_email_normalized_check
      CHECK (email IS NULL OR (email <> '' AND email = lower(btrim(email))));

    CREATE UNIQUE INDEX contacts_user_email_normalized_uniq
      ON contacts (user_id, lower(btrim(email)))
      WHERE email IS NOT NULL;

    ALTER TABLE thread_contacts           FORCE ROW LEVEL SECURITY;
    ALTER TABLE tasks                     FORCE ROW LEVEL SECURITY;
    ALTER TABLE notes                     FORCE ROW LEVEL SECURITY;
    ALTER TABLE meeting_attendees         FORCE ROW LEVEL SECURITY;
    ALTER TABLE account_contact_reporting FORCE ROW LEVEL SECURITY;
    ALTER TABLE account_contacts          FORCE ROW LEVEL SECURITY;
    ALTER TABLE contacts                  FORCE ROW LEVEL SECURITY;
  `);
};

exports.down = (pgm) => {
  // Duplicate consolidation and email normalization are intentionally not
  // reversible. Rolling back only removes the new invariant/index.
  pgm.sql(`
    DROP INDEX IF EXISTS contacts_user_email_normalized_uniq;
    ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_email_normalized_check;
    CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
  `);
};
