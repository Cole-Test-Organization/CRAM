exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE accounts       ENABLE ROW LEVEL SECURITY;
    ALTER TABLE accounts       FORCE ROW LEVEL SECURITY;
    ALTER TABLE contacts       ENABLE ROW LEVEL SECURITY;
    ALTER TABLE contacts       FORCE ROW LEVEL SECURITY;
    ALTER TABLE meetings       ENABLE ROW LEVEL SECURITY;
    ALTER TABLE meetings       FORCE ROW LEVEL SECURITY;
    ALTER TABLE internal_notes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE internal_notes FORCE ROW LEVEL SECURITY;
    ALTER TABLE account_contacts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE account_contacts FORCE ROW LEVEL SECURITY;
    ALTER TABLE meeting_attendees ENABLE ROW LEVEL SECURITY;
    ALTER TABLE meeting_attendees FORCE ROW LEVEL SECURITY;
  `);

  pgm.sql(`
    CREATE POLICY accounts_isolation ON accounts
      FOR ALL
      USING      (user_id = current_setting('app.current_user_id', true)::bigint)
      WITH CHECK (user_id = current_setting('app.current_user_id', true)::bigint);

    CREATE POLICY contacts_isolation ON contacts
      FOR ALL
      USING      (user_id = current_setting('app.current_user_id', true)::bigint)
      WITH CHECK (user_id = current_setting('app.current_user_id', true)::bigint);

    CREATE POLICY meetings_isolation ON meetings
      FOR ALL
      USING      (user_id = current_setting('app.current_user_id', true)::bigint)
      WITH CHECK (user_id = current_setting('app.current_user_id', true)::bigint);

    CREATE POLICY internal_notes_isolation ON internal_notes
      FOR ALL
      USING      (user_id = current_setting('app.current_user_id', true)::bigint)
      WITH CHECK (user_id = current_setting('app.current_user_id', true)::bigint);
  `);

  pgm.sql(`
    CREATE POLICY account_contacts_isolation ON account_contacts
      FOR ALL
      USING (
        EXISTS (SELECT 1 FROM accounts a WHERE a.id = account_contacts.account_id)
      )
      WITH CHECK (
        EXISTS (SELECT 1 FROM accounts a WHERE a.id = account_contacts.account_id)
        AND EXISTS (SELECT 1 FROM contacts c WHERE c.id = account_contacts.contact_id)
      );

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

exports.down = (pgm) => {
  pgm.sql(`
    DROP POLICY IF EXISTS meeting_attendees_isolation ON meeting_attendees;
    DROP POLICY IF EXISTS account_contacts_isolation ON account_contacts;
    DROP POLICY IF EXISTS internal_notes_isolation ON internal_notes;
    DROP POLICY IF EXISTS meetings_isolation ON meetings;
    DROP POLICY IF EXISTS contacts_isolation ON contacts;
    DROP POLICY IF EXISTS accounts_isolation ON accounts;

    ALTER TABLE meeting_attendees DISABLE ROW LEVEL SECURITY;
    ALTER TABLE account_contacts DISABLE ROW LEVEL SECURITY;
    ALTER TABLE internal_notes DISABLE ROW LEVEL SECURITY;
    ALTER TABLE meetings DISABLE ROW LEVEL SECURITY;
    ALTER TABLE contacts DISABLE ROW LEVEL SECURITY;
    ALTER TABLE accounts DISABLE ROW LEVEL SECURITY;
  `);
};
