// Three TEXT[] columns on opportunities for the classic "Why change / Why now /
// Why us" sales framework. Each column holds an ordered list of short reason
// strings (oldest at index 0, newest appended). Rendered as three columns in
// the GUI; agents can also read/write them through the API and MCP tool.
//
// Defaults to '{}' so existing rows and any inserts that don't specify the
// fields stay valid; NOT NULL to keep the read path simple (no null checks
// in the service / GUI).

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE opportunities
      ADD COLUMN why_change TEXT[] NOT NULL DEFAULT '{}',
      ADD COLUMN why_now    TEXT[] NOT NULL DEFAULT '{}',
      ADD COLUMN why_us     TEXT[] NOT NULL DEFAULT '{}';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE opportunities
      DROP COLUMN why_us,
      DROP COLUMN why_now,
      DROP COLUMN why_change;
  `);
};
