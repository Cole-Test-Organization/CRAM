// meetings.starts_at / meetings.ends_at — precise event start/end timestamps.
//
// The existing `meetings.date` column is a bare calendar DATE (no time of day):
// fine for "what day did we meet", useless for "which meeting am I in right
// now". The Google Calendar export already sends each event's `start` AND `end`
// as full ISO timestamps — the import previously collapsed `start` down to a
// local date (see calendar-import.localDate) and dropped `end` entirely. We now
// also persist the raw instants here so the GUI can render a Google-Calendar-
// style "Today" timeline with a live now-indicator and a "happening now"
// highlight.
//
// Both are NULLABLE timestamptz:
//   - notes-import rows and hand-entered meetings may have no time of day,
//   - timestamptz stores the canonical instant so the browser renders it in the
//     viewer's local zone (the user asked for "the time of my current machine").
// `date` stays as the grouping key / back-compat display column; these columns
// are purely additive — nothing that reads `date` today changes.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE meetings
      ADD COLUMN starts_at timestamptz,
      ADD COLUMN ends_at   timestamptz;
  `);
  // Partial index: the Today view (and any "timed meetings" query) filters to
  // rows that actually have a start. Most historical rows stay NULL until a
  // re-import backfills them, so a partial index keeps it small.
  pgm.sql(`
    CREATE INDEX idx_meetings_starts_at
      ON meetings (starts_at)
      WHERE starts_at IS NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS idx_meetings_starts_at;`);
  pgm.sql(`
    ALTER TABLE meetings
      DROP COLUMN IF EXISTS starts_at,
      DROP COLUMN IF EXISTS ends_at;
  `);
};
