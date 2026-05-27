// Drop the unused `amount` column from opportunities and add a
// `tech_validation_link` URL column alongside the existing `opp_link` and
// `trr_link`. Tracking dollar amounts in this app turned out to be noise —
// the linked external deal record is where pricing actually lives — and the
// SE workflow needs a third link slot for the tech-validation artifact.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE opportunities
      DROP COLUMN amount,
      ADD COLUMN tech_validation_link TEXT;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE opportunities
      DROP COLUMN tech_validation_link,
      ADD COLUMN amount NUMERIC(14,2);
  `);
};
