// meetings.location — free-text location for a meeting. For a virtual meeting
// this is the conferencing URL (Google Meet / Zoom / Teams); for an in-person
// one it's a room or address. The Google Calendar export sends it in `location`
// (e.g. "https://meet.google.com/abc-defg-hij" for a video call, "" for an
// all-day/holiday) and the import was dropping it. The Today timeline turns a
// URL location into a one-click "Join" button; a non-URL value renders as plain
// text. Nullable text — notes-import and hand-entered meetings may have none.

exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE meetings ADD COLUMN location text;`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE meetings DROP COLUMN IF EXISTS location;`);
};
