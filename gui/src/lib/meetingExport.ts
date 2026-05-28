import { api } from './api';
import { slugifyForFilename, isoToday } from './textExport';

export type ExportableMeeting = {
  id: number;
  title?: string | null;
  filename?: string | null;
  date?: string | null;
  attendees?: string | null;
  body?: string | null;
  contacts?: Array<{ full_name: string }> | null;
};

function meetingDisplayTitle(m: ExportableMeeting): string {
  return m.title || m.filename || 'Untitled meeting';
}

function meetingDisplayAttendees(m: ExportableMeeting): string {
  if (m.attendees && m.attendees.trim()) return m.attendees.trim();
  const fromContacts = (m.contacts || []).map((c) => c.full_name).filter(Boolean).join(', ');
  return fromContacts || '(none)';
}

export function formatMeeting(m: ExportableMeeting): string {
  const title = meetingDisplayTitle(m);
  const date = (m.date || '').trim() || '(no date)';
  const attendees = meetingDisplayAttendees(m);
  const notes = (m.body || '').trim();

  return [
    title,
    `Date: ${date}`,
    `Attendees: ${attendees}`,
    '',
    'Notes:',
    notes || '(no notes)',
  ].join('\n');
}

export function formatMeetings(meetings: ExportableMeeting[]): string {
  return meetings.map(formatMeeting).join('\n\n---\n\n') + '\n';
}

// The list endpoint omits `body`, so we re-fetch each selected meeting to get
// full notes. Callers that already have full records (the single-meeting view)
// could short-circuit, but the cost is one round-trip per id and keeps the
// caller dead-simple.
export async function fetchFullMeetings(ids: number[]): Promise<ExportableMeeting[]> {
  if (ids.length === 0) return [];
  const meetings = await Promise.all(ids.map((id) => api.getMeeting(id)));
  return meetings.filter(Boolean);
}

export function meetingsFilename(meetings: ExportableMeeting[]): string {
  if (meetings.length === 1) {
    const m = meetings[0];
    const stem = slugifyForFilename(meetingDisplayTitle(m));
    const date = m.date || isoToday();
    return `${date}-${stem}.txt`;
  }
  return `meetings-${isoToday()}-${meetings.length}.txt`;
}

// Drop-in for <ExportActions build={...}>.
export async function buildMeetingsExport(ids: number[]) {
  const meetings = await fetchFullMeetings(ids);
  return { text: formatMeetings(meetings), filename: meetingsFilename(meetings) };
}
