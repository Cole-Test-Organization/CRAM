import { api } from './api';
import { makeExportBuilder } from './textExport';

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
  return [
    meetingDisplayTitle(m),
    `Date: ${(m.date || '').trim() || '(no date)'}`,
    `Attendees: ${meetingDisplayAttendees(m)}`,
    '',
    'Notes:',
    (m.body || '').trim() || '(no notes)',
  ].join('\n');
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

const meetings = makeExportBuilder<ExportableMeeting>({
  format: formatMeeting,
  nameOf: meetingDisplayTitle,
  plural: 'meetings',
  dateOf: (m) => m.date,
});

// Drop-in for <ExportActions build={...}>.
export async function buildMeetingsExport(ids: number[]) {
  return meetings.build(await fetchFullMeetings(ids));
}
