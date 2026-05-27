exports.up = (pgm) => {
  // 1. Contacts gain a kind column (customer | partner | internal)
  pgm.sql(`
    ALTER TABLE contacts
      ADD COLUMN kind TEXT NOT NULL DEFAULT 'customer'
      CHECK (kind IN ('customer', 'partner', 'internal'));
    CREATE INDEX idx_contacts_kind ON contacts(kind);
  `);

  // 2. account_partners: links a customer account to its partner accounts
  pgm.sql(`
    CREATE TABLE account_partners (
      customer_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      partner_account_id  BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (customer_account_id, partner_account_id),
      CHECK (customer_account_id <> partner_account_id)
    );
    CREATE INDEX idx_ap_partner ON account_partners(partner_account_id);

    ALTER TABLE account_partners ENABLE ROW LEVEL SECURITY;
    ALTER TABLE account_partners FORCE  ROW LEVEL SECURITY;
    CREATE POLICY account_partners_isolation ON account_partners
      FOR ALL
      USING (
        EXISTS (SELECT 1 FROM accounts a WHERE a.id = account_partners.customer_account_id)
      )
      WITH CHECK (
        EXISTS (SELECT 1 FROM accounts a WHERE a.id = account_partners.customer_account_id)
        AND EXISTS (SELECT 1 FROM accounts a WHERE a.id = account_partners.partner_account_id)
      );
  `);

  // 3. internal_note_attendees: structured attendees for internal notes
  pgm.sql(`
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

  // 4. Temporarily lift FORCE RLS so the backfill can walk rows across users.
  //    The migration runs as the DB owner — FORCE is the only thing blocking it.
  pgm.sql(`
    ALTER TABLE accounts          NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE contacts          NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE account_contacts  NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE account_partners  NO FORCE ROW LEVEL SECURITY;
  `);

  // 5. Backfill partners + internals from the JSONB columns
  pgm.sql(`
    DO $$
    DECLARE
      acc                  RECORD;
      partner              RECORD;
      teammate             RECORD;
      partner_account_id   BIGINT;
      existing_contact_id  BIGINT;
      partner_slug         TEXT;
    BEGIN
      -- channel_partners → partner accounts + partner contacts + account_partners links
      FOR acc IN
        SELECT id, user_id, channel_partners
        FROM accounts
        WHERE channel_partners IS NOT NULL
          AND jsonb_typeof(channel_partners) = 'array'
          AND jsonb_array_length(channel_partners) > 0
      LOOP
        FOR partner IN
          SELECT * FROM jsonb_to_recordset(acc.channel_partners)
            AS x(name TEXT, company TEXT, email TEXT, role TEXT)
        LOOP
          IF partner.company IS NULL OR btrim(partner.company) = '' THEN
            RAISE NOTICE 'Skipping channel_partners entry with no company (account_id=%, name=%)',
              acc.id, partner.name;
            CONTINUE;
          END IF;

          partner_slug := lower(btrim(partner.company));
          partner_slug := regexp_replace(partner_slug, '[^a-z0-9]+', '-', 'g');
          partner_slug := regexp_replace(partner_slug, '^-|-$', '', 'g');

          IF partner_slug = '' THEN
            CONTINUE;
          END IF;

          -- Find-or-create the partner account (scoped to user)
          SELECT id INTO partner_account_id
          FROM accounts
          WHERE user_id = acc.user_id AND slug = partner_slug;

          IF partner_account_id IS NULL THEN
            INSERT INTO accounts (user_id, slug, name, status, domains)
            VALUES (acc.user_id, partner_slug, btrim(partner.company), 'partner', '[]'::jsonb)
            RETURNING id INTO partner_account_id;
          END IF;

          -- Link customer → partner
          INSERT INTO account_partners (customer_account_id, partner_account_id)
          VALUES (acc.id, partner_account_id)
          ON CONFLICT DO NOTHING;

          IF partner.name IS NULL OR btrim(partner.name) = '' THEN
            CONTINUE;
          END IF;

          -- Dedupe partner contact: email first, then name+company
          existing_contact_id := NULL;
          IF partner.email IS NOT NULL AND btrim(partner.email) <> '' THEN
            SELECT id INTO existing_contact_id
            FROM contacts
            WHERE user_id = acc.user_id
              AND kind = 'partner'
              AND lower(email) = lower(btrim(partner.email))
            LIMIT 1;
          END IF;

          IF existing_contact_id IS NULL THEN
            SELECT id INTO existing_contact_id
            FROM contacts
            WHERE user_id = acc.user_id
              AND kind = 'partner'
              AND lower(full_name) = lower(btrim(partner.name))
              AND lower(coalesce(company, '')) = lower(btrim(partner.company))
            LIMIT 1;
          END IF;

          IF existing_contact_id IS NULL THEN
            INSERT INTO contacts (user_id, full_name, company, title, email, kind)
            VALUES (
              acc.user_id,
              btrim(partner.name),
              btrim(partner.company),
              NULLIF(btrim(coalesce(partner.role, '')), ''),
              NULLIF(btrim(coalesce(partner.email, '')), ''),
              'partner'
            )
            RETURNING id INTO existing_contact_id;
          END IF;

          -- Tie the partner contact to its partner account
          INSERT INTO account_contacts (account_id, contact_id)
          VALUES (partner_account_id, existing_contact_id)
          ON CONFLICT DO NOTHING;
        END LOOP;
      END LOOP;

      -- pa_team → internal contacts (no account link; internal contacts float)
      FOR acc IN
        SELECT id, user_id, pa_team
        FROM accounts
        WHERE pa_team IS NOT NULL
          AND jsonb_typeof(pa_team) = 'array'
          AND jsonb_array_length(pa_team) > 0
      LOOP
        FOR teammate IN
          SELECT * FROM jsonb_to_recordset(acc.pa_team)
            AS x(name TEXT, role TEXT, email TEXT, background TEXT)
        LOOP
          IF teammate.name IS NULL OR btrim(teammate.name) = '' THEN
            CONTINUE;
          END IF;

          existing_contact_id := NULL;
          IF teammate.email IS NOT NULL AND btrim(teammate.email) <> '' THEN
            SELECT id INTO existing_contact_id
            FROM contacts
            WHERE user_id = acc.user_id
              AND kind = 'internal'
              AND lower(email) = lower(btrim(teammate.email))
            LIMIT 1;
          END IF;

          IF existing_contact_id IS NULL THEN
            SELECT id INTO existing_contact_id
            FROM contacts
            WHERE user_id = acc.user_id
              AND kind = 'internal'
              AND lower(full_name) = lower(btrim(teammate.name))
            LIMIT 1;
          END IF;

          IF existing_contact_id IS NULL THEN
            INSERT INTO contacts (user_id, full_name, title, email, notes, kind)
            VALUES (
              acc.user_id,
              btrim(teammate.name),
              NULLIF(btrim(coalesce(teammate.role, '')), ''),
              NULLIF(btrim(coalesce(teammate.email, '')), ''),
              NULLIF(btrim(coalesce(teammate.background, '')), ''),
              'internal'
            );
          END IF;
        END LOOP;
      END LOOP;
    END $$;
  `);

  // 6. Re-enable FORCE RLS
  pgm.sql(`
    ALTER TABLE accounts          FORCE ROW LEVEL SECURITY;
    ALTER TABLE contacts          FORCE ROW LEVEL SECURITY;
    ALTER TABLE account_contacts  FORCE ROW LEVEL SECURITY;
    ALTER TABLE account_partners  FORCE ROW LEVEL SECURITY;
  `);

  // 7. Drop the JSONB columns. search_vector referenced them, so rebuild it.
  pgm.sql(`
    ALTER TABLE accounts DROP COLUMN search_vector;
    ALTER TABLE accounts DROP COLUMN channel_partners;
    ALTER TABLE accounts DROP COLUMN pa_team;
    ALTER TABLE accounts ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
      to_tsvector('english',
        coalesce(slug, '') || ' ' ||
        coalesce(name, '') || ' ' ||
        coalesce(status, '') || ' ' ||
        coalesce(relationship_summary, '') || ' ' ||
        coalesce(environment::text, '') || ' ' ||
        coalesce(open_threads::text, '') || ' ' ||
        coalesce(domains::text, '')
      )
    ) STORED;
    CREATE INDEX idx_accounts_search ON accounts USING GIN (search_vector);
  `);
};

exports.down = (pgm) => {
  // Schema-only rollback: JSONB columns come back empty. The backfill can't be
  // reversed automatically — a real rollback would need a DB restore.
  pgm.sql(`
    ALTER TABLE accounts DROP COLUMN search_vector;
    ALTER TABLE accounts ADD COLUMN channel_partners JSONB;
    ALTER TABLE accounts ADD COLUMN pa_team          JSONB;
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

    DROP POLICY IF EXISTS internal_note_attendees_isolation ON internal_note_attendees;
    DROP TABLE IF EXISTS internal_note_attendees;

    DROP POLICY IF EXISTS account_partners_isolation ON account_partners;
    DROP TABLE IF EXISTS account_partners;

    DROP INDEX IF EXISTS idx_contacts_kind;
    ALTER TABLE contacts DROP COLUMN kind;
  `);
};
