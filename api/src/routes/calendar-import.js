// Calendar-import HTTP surface. One synchronous intake:
//   POST /api/calendar-import — JSON { date, timezone, meetings: [...] }
//     The day's Google Calendar export (typically forwarded from a Google
//     Apps Script through a Cloudflare tunnel). Creates a meeting per event
//     the user hasn't declined, resolving attendees/accounts by email domain,
//     and returns a per-event report. See CalendarImportService for the rules.
//
// There is no app-level auth yet (the API trusts whoever reaches it). When this
// endpoint is exposed through a tunnel, the Cloudflare Access service token is
// the real gate; as defense-in-depth, set CALENDAR_IMPORT_TOKEN and the route
// additionally requires a matching `x-calendar-import-token` header, so a direct
// hit to the origin port without the secret is rejected. Unset ⇒ no extra check.

const BODY_LIMIT = Number(process.env.CALENDAR_IMPORT_BODY_LIMIT) || 16 * 1024 * 1024; // 16MB

export default async function calendarImportRoutes(fastify, { calendarImportService }) {
  const expectedToken = process.env.CALENDAR_IMPORT_TOKEN || null;

  fastify.post('/calendar-import', {
    bodyLimit: BODY_LIMIT,
    schema: {
      description: 'Import a day of Google Calendar events (the JSON your daily export forwards through the tunnel). For each event whose RSVP is not "Declined" (all-day events skipped by default): attendee emails are classified by domain — internal domains → kind=internal contacts (no account link); a domain matching a status=partner account (or listed in CALENDAR_PARTNER_DOMAINS) → kind=partner; personal/freemail domains (gmail, yahoo, …) are skipped; any other business domain → kind=account. The meeting attaches to the most-attended CUSTOMER domain (internal/partner never decide it); with no customer domain it becomes an internal note. Unknown customer domains auto-create an account flagged needs_review (the meeting inherits needs_review only when its account was just minted). The calendar description (HTML) is converted to markdown and prepended to the meeting body. Synchronous — returns a per-event report. Idempotent: re-sending a day is a no-op (meetings are keyed on the calendar event id). If CALENDAR_IMPORT_TOKEN is configured, send it as the x-calendar-import-token header.',
      tags: ['calendar-import'],
      body: {
        type: 'object',
        required: ['meetings'],
        properties: {
          date: { type: 'string', description: 'The export\'s local date (YYYY-MM-DD). Informational; per-event dates are derived from each event\'s start in `timezone`.' },
          calendarId: { type: 'string', description: 'Source calendar id (e.g. "primary"). Recorded for context, not required.' },
          timezone: { type: 'string', description: 'IANA timezone of the calendar (e.g. "America/Chicago"). Used to derive each meeting\'s local date from its UTC start. Defaults to UTC.' },
          self: { type: 'string', description: 'The calendar owner\'s email. Excluded from contact creation so you never become a contact for yourself. Falls back to the CALENDAR_SELF_EMAIL env var.' },
          owner: { type: 'string', description: 'Alias for `self`.' },
          count: { type: 'integer', description: 'Optional event count from the exporter; ignored (meetings[].length is authoritative).' },
          meetings: {
            type: 'array',
            description: 'The day\'s events.',
            items: {
              type: 'object',
              required: ['id'],
              properties: {
                id: { type: 'string', description: 'Stable calendar event id (recurring instances carry a per-instance id). Used to derive the meeting filename for idempotent re-imports.' },
                title: { type: 'string' },
                start: { type: 'string', description: 'Event start, ISO 8601 (usually UTC, e.g. "2026-06-01T14:30:00.000Z"). The meeting date is this rendered in `timezone`.' },
                end: { type: 'string' },
                isAllDay: { type: 'boolean', description: 'All-day events are skipped unless CALENDAR_IMPORT_ALL_DAY=true.' },
                location: { type: 'string' },
                guestCount: { type: 'integer' },
                guestEmails: { type: 'array', items: { type: 'string' }, description: 'Attendee email addresses. Classified by domain (internal/partner/personal/customer) to create contacts and pick the account. Legacy fallback — prefer guests[] when display names / RSVP status are available.' },
                guests: {
                  type: 'array',
                  description: 'Structured attendees [{ email, name, status }] — preferred over guestEmails. `name` is the invite display name ("" when none — the contact stays email-only until a later event carries a name); `status` is the RSVP/attendance (Going | Declined | Maybe | Invited | Owner | ""). Names flow into the contact via fill-only enrich; status is recorded per attendee on meeting_attendees.status (normalized to going/declined/maybe/invited/owner, or null for unrecognized values). Falls back to guestEmails[] when omitted.',
                  items: {
                    type: 'object',
                    properties: {
                      email: { type: 'string' },
                      name: { type: 'string' },
                      status: { type: 'string' },
                    },
                  },
                },
                myStatus: { type: 'string', description: 'The owner\'s RSVP. Only "Declined" (case-insensitive) is skipped; Going/Maybe/Invited/unknown all import.' },
                description: { type: 'string', description: 'Event description (HTML ok). Converted to markdown and prepended to the meeting body for review.' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    if (expectedToken) {
      const provided = request.headers['x-calendar-import-token'];
      if (provided !== expectedToken) {
        reply.code(401);
        return { error: 'Missing or invalid x-calendar-import-token header.' };
      }
    }
    try {
      const report = await calendarImportService.importDay(request.userId, request.body);
      return report;
    } catch (err) {
      if (err.statusCode) { reply.code(err.statusCode); return { error: err.message }; }
      throw err;
    }
  });
}
