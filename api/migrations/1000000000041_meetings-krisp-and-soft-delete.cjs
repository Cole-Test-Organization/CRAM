// Two additions to `meetings`, both needed for Krisp ingestion + the generic
// merge feature:
//
//   krisp_meeting_id — the Krisp meeting id the notes came from. Lets the Krisp
//     webhook (a) dedupe re-deliveries, (b) re-find the meeting when a follow-up
//     event (e.g. the transcript) arrives for the same Krisp meeting, and (c)
//     survive a merge (it's carried to the surviving row). Unique per user among
//     LIVE rows.
//
//   deleted_at — soft-delete tombstone. The merge feature is non-destructive:
//     when you merge one meeting into another you choose what to bring over, so
//     the absorbed row may still hold fields you didn't pull — we tombstone it
//     (recoverable) rather than hard-delete. Every read path filters
//     `deleted_at IS NULL`, and the filename / krisp unique indexes exclude
//     tombstoned rows so a re-import can reuse a filename/krisp id freed by a
//     merge.

exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE meetings ADD COLUMN krisp_meeting_id text;`);
  pgm.sql(`ALTER TABLE meetings ADD COLUMN deleted_at timestamptz;`);

  // Recreate the two filename partial-unique indexes so tombstoned rows don't
  // occupy a (account_id, filename) / (user_id, filename) slot — otherwise a
  // re-import after a merge would 23505 against a hidden row.
  pgm.sql(`DROP INDEX IF EXISTS meetings_account_filename_uniq;`);
  pgm.sql(`DROP INDEX IF EXISTS meetings_internal_filename_uniq;`);
  pgm.sql(`CREATE UNIQUE INDEX meetings_account_filename_uniq ON meetings (account_id, filename) WHERE (account_id IS NOT NULL AND deleted_at IS NULL);`);
  pgm.sql(`CREATE UNIQUE INDEX meetings_internal_filename_uniq ON meetings (user_id, filename) WHERE (account_id IS NULL AND deleted_at IS NULL);`);

  // One live meeting per (user, krisp_meeting_id).
  pgm.sql(`CREATE UNIQUE INDEX meetings_krisp_meeting_id_uniq ON meetings (user_id, krisp_meeting_id) WHERE (krisp_meeting_id IS NOT NULL AND deleted_at IS NULL);`);

  // Cheap "live rows only" filter for the read paths.
  pgm.sql(`CREATE INDEX idx_meetings_not_deleted ON meetings (id) WHERE deleted_at IS NULL;`);
};

exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS meetings_krisp_meeting_id_uniq;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_meetings_not_deleted;`);
  pgm.sql(`DROP INDEX IF EXISTS meetings_account_filename_uniq;`);
  pgm.sql(`DROP INDEX IF EXISTS meetings_internal_filename_uniq;`);
  // Restore the original (non-soft-delete-aware) unique indexes.
  pgm.sql(`CREATE UNIQUE INDEX meetings_account_filename_uniq ON meetings (account_id, filename) WHERE (account_id IS NOT NULL);`);
  pgm.sql(`CREATE UNIQUE INDEX meetings_internal_filename_uniq ON meetings (user_id, filename) WHERE (account_id IS NULL);`);
  pgm.sql(`ALTER TABLE meetings DROP COLUMN IF EXISTS deleted_at;`);
  pgm.sql(`ALTER TABLE meetings DROP COLUMN IF EXISTS krisp_meeting_id;`);
};
