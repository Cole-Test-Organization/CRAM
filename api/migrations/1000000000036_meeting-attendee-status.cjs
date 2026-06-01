// meeting_attendees.status — record each attendee's RSVP / attendance response
// for THIS meeting on the join row. A contact can attend many meetings, each
// with a different response (Going one week, Declined the next), so the status
// belongs on the meeting↔contact link, not on the contact. meeting_attendees is
// already that many-to-many join (linked contact OR unlinked display_name); this
// just adds the per-link status.
//
// Populated by the calendar import from each guest's `status` in the structured
// guests[] payload ("Going" | "Declined" | "Maybe" | "Invited" | "Owner"),
// normalized to a lowercase canonical token in the service. NULL when unknown or
// not sourced from a calendar (notes-import unlinked rows, contacts attached via
// the meeting create API without a status, legacy guestEmails-only events).
//
// CHECK-constrained to the canonical set, matching the enum style used for
// contacts.kind and opportunities.stage. The service maps any unrecognized
// external label to NULL before it reaches the DB, so a new calendar label can
// never trip this constraint — it just records no status.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE meeting_attendees
      ADD COLUMN status TEXT
      CHECK (status IS NULL OR status IN ('going', 'declined', 'maybe', 'invited', 'owner'));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE meeting_attendees DROP COLUMN status;`);
};
