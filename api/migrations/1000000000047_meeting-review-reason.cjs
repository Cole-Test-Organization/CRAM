// meetings.review_reason — typed explanation for why a meeting is in the
// review queue. `meetings.needs_review` stays the cheap queue boolean, but the
// reason distinguishes account-placement triage, Krisp-match triage, and legacy
// account-created review rows instead of forcing the GUI to infer from
// account_id.

const reasons = [
  'manual',
  'account_unassigned',
  'account_ambiguous',
  'account_auto_created',
  'krisp_no_match',
  'krisp_multiple_matches',
  'krisp_match_legacy',
];

exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE meetings ADD COLUMN review_reason text;`);

  pgm.sql(`
    UPDATE meetings
       SET review_reason = CASE
         WHEN NOT needs_review THEN NULL
         WHEN krisp_meeting_id IS NOT NULL AND account_id IS NOT NULL THEN 'krisp_match_legacy'
         WHEN krisp_meeting_id IS NOT NULL THEN 'krisp_no_match'
         WHEN account_id IS NOT NULL THEN 'account_auto_created'
         ELSE 'account_unassigned'
       END
  `);

  pgm.sql(`
    ALTER TABLE meetings
      ADD CONSTRAINT meetings_review_reason_check
      CHECK (
        (needs_review = false AND review_reason IS NULL)
        OR
        (needs_review = true AND review_reason IN (${reasons.map((r) => `'${r}'`).join(', ')}))
      )
  `);

  pgm.sql(`CREATE INDEX idx_meetings_review_reason ON meetings (review_reason) WHERE needs_review = true;`);
};

exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS idx_meetings_review_reason;`);
  pgm.sql(`ALTER TABLE meetings DROP CONSTRAINT IF EXISTS meetings_review_reason_check;`);
  pgm.sql(`ALTER TABLE meetings DROP COLUMN IF EXISTS review_reason;`);
};
