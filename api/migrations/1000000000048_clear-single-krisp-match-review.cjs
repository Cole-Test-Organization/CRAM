// Clear legacy Krisp review flags that came from the old "all Krisp matches
// need review" behavior. Under the current rule, a Krisp-matched meeting only
// remains in review when more than one meeting falls inside the start-time
// matching window.

exports.up = (pgm) => {
  pgm.sql(`
    WITH legacy AS (
      SELECT
        m.id,
        COUNT(c.id) AS candidate_count
      FROM meetings m
      LEFT JOIN meetings c
        ON c.user_id = m.user_id
       AND c.deleted_at IS NULL
       AND c.starts_at IS NOT NULL
       AND c.starts_at BETWEEN m.starts_at - interval '10 minutes'
                           AND m.starts_at + interval '10 minutes'
      WHERE m.needs_review = true
        AND m.review_reason = 'krisp_match_legacy'
        AND m.krisp_meeting_id IS NOT NULL
        AND m.account_id IS NOT NULL
        AND m.starts_at IS NOT NULL
        AND m.deleted_at IS NULL
      GROUP BY m.id
    )
    UPDATE meetings m
       SET needs_review = legacy.candidate_count > 1,
           review_reason = CASE
             WHEN legacy.candidate_count > 1 THEN 'krisp_multiple_matches'
             ELSE NULL
           END
      FROM legacy
     WHERE m.id = legacy.id
  `);
};

exports.down = () => {
  // Data cleanup is intentionally not reversible without recording each prior
  // row state.
};
