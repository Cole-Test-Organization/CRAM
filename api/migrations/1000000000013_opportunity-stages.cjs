// Replace the three legacy opportunity stages (open / closed_won / closed_lost)
// with a tech-validation SE pipeline (9 stages, 0–8).
//
// Existing data:
//   open        → opp_identification  (start of the funnel)
//   closed_won  → tech_win_closed
//   closed_lost → tech_loss_closed

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE opportunities DROP CONSTRAINT opportunities_stage_check;

    UPDATE opportunities SET stage = 'opp_identification' WHERE stage = 'open';
    UPDATE opportunities SET stage = 'tech_win_closed'    WHERE stage = 'closed_won';
    UPDATE opportunities SET stage = 'tech_loss_closed'   WHERE stage = 'closed_lost';

    ALTER TABLE opportunities ALTER COLUMN stage SET DEFAULT 'opp_identification';

    ALTER TABLE opportunities ADD CONSTRAINT opportunities_stage_check
      CHECK (stage IN (
        'opp_identification',
        'tech_discovery',
        'non_pov_tech_validation',
        'pov_planning',
        'pov_tech_validation',
        'tech_decision_pending',
        'tech_loss_closed',
        'tech_win_closed',
        'no_tech_validation_closed'
      ));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE opportunities DROP CONSTRAINT opportunities_stage_check;

    UPDATE opportunities SET stage = 'closed_won'  WHERE stage = 'tech_win_closed';
    UPDATE opportunities SET stage = 'closed_lost' WHERE stage IN ('tech_loss_closed', 'no_tech_validation_closed');
    UPDATE opportunities SET stage = 'open'        WHERE stage IN (
      'opp_identification', 'tech_discovery', 'non_pov_tech_validation',
      'pov_planning', 'pov_tech_validation', 'tech_decision_pending'
    );

    ALTER TABLE opportunities ALTER COLUMN stage SET DEFAULT 'open';
    ALTER TABLE opportunities ADD CONSTRAINT opportunities_stage_check
      CHECK (stage IN ('open', 'closed_won', 'closed_lost'));
  `);
};
