// Per-meeting RSVP / attendance status (from meeting_attendees.status), shared
// by the meeting view (attendee chips) and the contact view (meeting history).
// null = unknown (notes-import rows, legacy events, contacts attached without a
// status).
import type { AttendeeStatus } from './types';

export const ATTENDEE_STATUS_LABEL: Record<string, string> = {
  going: 'Going', declined: 'Declined', maybe: 'Maybe', invited: 'Invited', owner: 'Owner',
};

// Neobrutalism palette: going/owner = surf (present), declined = scarlet,
// maybe = amber, invited/other = muted base.
export function attendeeStatusClass(status: string): string {
  switch (status) {
    case 'going':
    case 'owner': return 'border-surf-300 text-surf-300';
    case 'declined': return 'border-scarlet-400 text-scarlet-400';
    case 'maybe': return 'border-amber-300 text-amber-300';
    default: return 'border-base-500 text-base-300';
  }
}

export function attendeeStatusLabel(status: AttendeeStatus | string): string {
  return ATTENDEE_STATUS_LABEL[status] || status;
}
