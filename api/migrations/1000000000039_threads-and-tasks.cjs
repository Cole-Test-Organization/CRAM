// Threads + tasks: replace the freeform accounts.open_threads JSONB blob with a
// normalized relational model.
//
//   thread  — an open workstream with exactly ONE customer account. The
//             relationship-level "where do we stand" record (system of record).
//             Lifecycle via closed_at (NULL = open); closed threads are hidden
//             in the GUI by default.
//   task    — one actionable step within a thread. The CRM owns completion for
//             now (completed_at, NULL = open); there is deliberately NO Todoist
//             link yet — that integration is a later conversation. assignee is
//             nullable (NULL = "no one"; never auto-assigned to the current user).
//   thread_contacts — the people involved in a thread (the pool you pick
//             assignees from). Distinct from any single task's assignee.
//
// RLS: threads + tasks use the standard per-user user_id policy. thread_contacts
// is a junction with no user_id, so it uses the parent-EXISTS policy idiom from
// account_contacts / meeting_attendees (migration 0003) — you can only touch a
// link whose parent thread is visible to you.
//
// The old accounts.open_threads ([{ text, done }]) is backfilled losslessly into
// threads (one thread per item; done ⇒ closed_at) BEFORE the column is dropped,
// so no data is lost on any instance this runs against (the real CRM is remote).
// The backfill runs as the DB owner with no app.current_user_id set, so FORCE
// RLS is lifted on accounts + threads for the copy and restored after — the same
// idiom migration 0008 used. user_id is sourced per-account, so it stays
// multi-tenant-correct rather than collapsing everything onto one user.
//
// Dropping open_threads requires rebuilding the generated accounts.search_vector
// without it (a generated column can't be dropped while it references the
// column) — the same drop-rebuild dance migration 0011 used for accounts.environment.

exports.up = (pgm) => {
  // ── threads ──────────────────────────────────────────────────────────────
  pgm.sql(`
    CREATE TABLE threads (
      id          BIGSERIAL PRIMARY KEY,
      user_id     BIGINT NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
      account_id  BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      description TEXT,
      closed_at   TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX idx_threads_user         ON threads(user_id);
    CREATE INDEX idx_threads_account_open ON threads(account_id, created_at DESC) WHERE closed_at IS NULL;
    CREATE INDEX idx_threads_account_all  ON threads(account_id, created_at DESC);
    CREATE TRIGGER threads_updated_at BEFORE UPDATE ON threads
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    ALTER TABLE threads ENABLE ROW LEVEL SECURITY;
    ALTER TABLE threads FORCE  ROW LEVEL SECURITY;
    CREATE POLICY threads_isolation ON threads
      FOR ALL
      USING      (user_id = current_setting('app.current_user_id', true)::bigint)
      WITH CHECK (user_id = current_setting('app.current_user_id', true)::bigint);
  `);

  // ── tasks ────────────────────────────────────────────────────────────────
  pgm.sql(`
    CREATE TABLE tasks (
      id                  BIGSERIAL PRIMARY KEY,
      user_id             BIGINT NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
      thread_id           BIGINT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      assignee_contact_id BIGINT REFERENCES contacts(id)         ON DELETE SET NULL,
      title               TEXT NOT NULL,
      description         TEXT,
      due_date            DATE,
      completed_at        TIMESTAMPTZ,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX idx_tasks_user        ON tasks(user_id);
    CREATE INDEX idx_tasks_thread_open ON tasks(thread_id, due_date) WHERE completed_at IS NULL;
    CREATE INDEX idx_tasks_thread_all  ON tasks(thread_id);
    CREATE INDEX idx_tasks_assignee    ON tasks(assignee_contact_id) WHERE assignee_contact_id IS NOT NULL;
    CREATE TRIGGER tasks_updated_at BEFORE UPDATE ON tasks
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
    ALTER TABLE tasks FORCE  ROW LEVEL SECURITY;
    CREATE POLICY tasks_isolation ON tasks
      FOR ALL
      USING      (user_id = current_setting('app.current_user_id', true)::bigint)
      WITH CHECK (user_id = current_setting('app.current_user_id', true)::bigint);
  `);

  // ── thread_contacts (junction; rides the parent thread's RLS) ─────────────
  pgm.sql(`
    CREATE TABLE thread_contacts (
      thread_id  BIGINT NOT NULL REFERENCES threads(id)  ON DELETE CASCADE,
      contact_id BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      PRIMARY KEY (thread_id, contact_id)
    );
    CREATE INDEX idx_tc_contact ON thread_contacts(contact_id);

    ALTER TABLE thread_contacts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE thread_contacts FORCE  ROW LEVEL SECURITY;
    CREATE POLICY thread_contacts_isolation ON thread_contacts
      FOR ALL
      USING (
        EXISTS (SELECT 1 FROM threads t WHERE t.id = thread_contacts.thread_id)
      )
      WITH CHECK (
        EXISTS (SELECT 1 FROM threads t WHERE t.id = thread_contacts.thread_id)
        AND EXISTS (SELECT 1 FROM contacts c WHERE c.id = thread_contacts.contact_id)
      );
  `);

  // ── backfill accounts.open_threads → threads (lossless) ───────────────────
  // Lift FORCE RLS so the owner-run copy can read accounts and write threads
  // with no app.current_user_id in scope; restore it immediately after.
  pgm.sql(`
    ALTER TABLE accounts NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE threads  NO FORCE ROW LEVEL SECURITY;

    INSERT INTO threads (user_id, account_id, title, closed_at)
    SELECT a.user_id,
           a.id,
           NULLIF(TRIM(elem->>'text'), ''),
           CASE WHEN lower(coalesce(elem->>'done', '')) IN ('true', 't') THEN NOW() END
    FROM accounts a
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(a.open_threads) = 'array' THEN a.open_threads ELSE '[]'::jsonb END
    ) AS elem
    WHERE NULLIF(TRIM(elem->>'text'), '') IS NOT NULL;

    ALTER TABLE accounts FORCE ROW LEVEL SECURITY;
    ALTER TABLE threads  FORCE ROW LEVEL SECURITY;
  `);

  // ── drop accounts.open_threads + rebuild search_vector without it ─────────
  pgm.sql(`
    ALTER TABLE accounts DROP COLUMN search_vector;
    ALTER TABLE accounts DROP COLUMN open_threads;
    ALTER TABLE accounts ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
      to_tsvector('english',
        coalesce(slug, '') || ' ' ||
        coalesce(name, '') || ' ' ||
        coalesce(status, '') || ' ' ||
        coalesce(relationship_summary, '') || ' ' ||
        coalesce(domains::text, '')
      )
    ) STORED;
    CREATE INDEX idx_accounts_search ON accounts USING GIN (search_vector);
  `);
};

exports.down = (pgm) => {
  // Restore accounts.open_threads (column + search_vector with it), best-effort
  // backfill from threads ({ text: title, done: closed_at IS NOT NULL }), then
  // drop the new tables. Task text, descriptions, and contact links have no home
  // in the old [{ text, done }] shape, so down restores the schema and top-level
  // threads only — not the full normalized graph.
  pgm.sql(`
    ALTER TABLE accounts DROP COLUMN search_vector;
    ALTER TABLE accounts ADD COLUMN open_threads JSONB;
  `);

  pgm.sql(`
    ALTER TABLE accounts NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE threads  NO FORCE ROW LEVEL SECURITY;

    UPDATE accounts a SET open_threads = src.items
    FROM (
      SELECT account_id,
             jsonb_agg(
               jsonb_build_object('text', title, 'done', closed_at IS NOT NULL)
               ORDER BY created_at
             ) AS items
      FROM threads
      GROUP BY account_id
    ) src
    WHERE src.account_id = a.id;

    ALTER TABLE accounts FORCE ROW LEVEL SECURITY;
    ALTER TABLE threads  FORCE ROW LEVEL SECURITY;
  `);

  pgm.sql(`
    ALTER TABLE accounts ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
      to_tsvector('english',
        coalesce(slug, '') || ' ' ||
        coalesce(name, '') || ' ' ||
        coalesce(status, '') || ' ' ||
        coalesce(relationship_summary, '') || ' ' ||
        coalesce(open_threads::text, '') || ' ' ||
        coalesce(domains::text, '')
      )
    ) STORED;
    CREATE INDEX idx_accounts_search ON accounts USING GIN (search_vector);
  `);

  pgm.sql(`
    DROP POLICY IF EXISTS tasks_isolation ON tasks;
    ALTER TABLE tasks DISABLE ROW LEVEL SECURITY;
    DROP TABLE IF EXISTS tasks;

    DROP POLICY IF EXISTS thread_contacts_isolation ON thread_contacts;
    ALTER TABLE thread_contacts DISABLE ROW LEVEL SECURITY;
    DROP TABLE IF EXISTS thread_contacts;

    DROP POLICY IF EXISTS threads_isolation ON threads;
    ALTER TABLE threads DISABLE ROW LEVEL SECURITY;
    DROP TABLE IF EXISTS threads;
  `);
};
