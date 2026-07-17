/**
 * Calendar › POST a day's meetings to an HTTP endpoint (Cloudflare Access)
 * ---------------------------------------------------------------------------
 * Fetches meetings for TARGET_DATE and POSTs them as JSON to an endpoint that
 * sits behind Cloudflare Access, authenticating with a service token
 * (Client ID + Client Secret) via the CF-Access-Client-Id / -Secret headers.
 *
 * Stored for copy-paste into the Apps Script editor — clasp is blocked by
 * admin policy. PASTE THIS INTO ITS OWN PROJECT: it is self-contained, and its
 * CONFIG consts / helpers would collide with list-meetings-for-day.gs.
 *
 * ONE-TIME SETUP (keeps your secret OUT of this file / the repo):
 *   1. Cloudflare Zero Trust → Access → Service Auth → create a Service Token.
 *      Copy the Client ID (looks like "xxxx.access") and the Client Secret
 *      (shown only once). Ensure your Access application has a policy with the
 *      "Service Auth" action that includes this token.
 *   2. In the Apps Script editor: Project Settings (gear) → Script Properties →
 *      Add property, twice (paste ONLY the token values — no header-name prefix):
 *        CF_ACCESS_CLIENT_ID      = <your Service Token Client ID, e.g. xxxxxxxx.access>
 *        CF_ACCESS_CLIENT_SECRET  = <your Service Token Client Secret, shown once in Cloudflare>
 *   3. Set CONFIG below, choose `postMeetingsToEndpoint`, then click Run.
 *      First run prompts for Calendar AND external-request permissions — approve both.
 *   4. Check the Execution log for the HTTP status + response body.
 * ---------------------------------------------------------------------------
 */

// =============================== CONFIG ===============================
/** Where to POST. Append a path if your endpoint expects one, e.g. '.../ingest'. */
const ENDPOINT_URL = 'https://calendar.justcole.com';

/** The day to export, as YYYY-MM-DD (in your calendar's timezone). */
const TARGET_DATE = '2026-05-31';

/** Calendar to read. 'primary' = your default calendar, or a calendar ID. */
const CALENDAR_ID = 'primary';

/** true = only events with other guests (real meetings); false = every event. */
const ONLY_WITH_GUESTS = false;
// ======================================================================


/** ENTRY POINT — set CONFIG + Script Properties above, then click Run. */
function postMeetingsToEndpoint() {
  const clientId = getRequiredProp_('CF_ACCESS_CLIENT_ID');
  const clientSecret = getRequiredProp_('CF_ACCESS_CLIENT_SECRET');

  const cal = (!CALENDAR_ID || CALENDAR_ID === 'primary')
    ? CalendarApp.getDefaultCalendar()
    : CalendarApp.getCalendarById(CALENDAR_ID);
  if (!cal) throw new Error(`Calendar not found or not accessible: ${CALENDAR_ID}`);

  const meetings = getMeetingsForDay(TARGET_DATE, {
    calendarId: CALENDAR_ID,
    onlyWithGuests: ONLY_WITH_GUESTS,
  });

  const payload = {
    date: TARGET_DATE,
    calendarId: CALENDAR_ID,
    timezone: cal.getTimeZone(),
    count: meetings.length,
    meetings: meetings, // Date fields serialize to ISO 8601 strings
  };

  const response = UrlFetchApp.fetch(ENDPOINT_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'CF-Access-Client-Id': clientId,
      'CF-Access-Client-Secret': clientSecret,
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true, // read error bodies instead of throwing
    followRedirects: false,   // a redirect to a login page means auth failed
  });

  const code = response.getResponseCode();
  const body = response.getContentText();

  Logger.log(`POST ${ENDPOINT_URL}`);
  Logger.log(`Sent ${meetings.length} meeting(s) for ${TARGET_DATE} → HTTP ${code}`);
  Logger.log(`Response: ${truncate_(body, 800)}`);

  if (code < 200 || code >= 300) {
    if ((code >= 300 && code < 400) || /cloudflare|access denied|<html|sign in|login/i.test(body)) {
      Logger.log('⚠️  Looks like a Cloudflare Access challenge, not your origin. Verify: ' +
                 '(a) a Service Auth policy includes this token, and ' +
                 '(b) the Client ID/Secret in Script Properties are correct.');
    }
    throw new Error(`POST failed: HTTP ${code}`);
  }

  Logger.log('✅ Posted successfully.');
  return { httpStatus: code, sent: meetings.length };
}


// ------------------------------- helpers -------------------------------

/** Read a required Script Property, or throw with setup instructions. */
function getRequiredProp_(key) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) {
    throw new Error(
      `Missing Script Property "${key}". Set it via Project Settings (gear) → ` +
      `Script Properties — see the SETUP comment at the top of this file.`);
  }
  return value;
}

/** Trim long response bodies for logging. */
function truncate_(str, max) {
  str = String(str || '');
  return str.length > max ? `${str.slice(0, max)}… (${str.length} chars total)` : str;
}

/**
 * Return a structured, time-sorted list of meetings for a single day.
 * (Same logic as list-meetings-for-day.gs — duplicated so this file stands alone.)
 */
function getMeetingsForDay(dateInput, opts = {}) {
  const calendarId = opts.calendarId || 'primary';
  const onlyWithGuests = !!opts.onlyWithGuests;

  const cal = (!calendarId || calendarId === 'primary')
    ? CalendarApp.getDefaultCalendar()
    : CalendarApp.getCalendarById(calendarId);
  if (!cal) throw new Error(`Calendar not found or not accessible: ${calendarId}`);

  const tz = cal.getTimeZone();
  const events = cal.getEventsForDay(toLocalDate(dateInput));

  return events
    .map((ev) => {
      const allDay = ev.isAllDayEvent();
      const guests = ev.getGuestList();
      const guestObjs = buildGuests_(guests);
      return {
        title: ev.getTitle() || '(no title)',
        isAllDay: allDay,
        start: ev.getStartTime(),
        end: ev.getEndTime(),
        startStr: allDay ? 'All day' : Utilities.formatDate(ev.getStartTime(), tz, 'h:mm a'),
        endStr: allDay ? '' : Utilities.formatDate(ev.getEndTime(), tz, 'h:mm a'),
        location: ev.getLocation() || '',
        guestCount: guests.length,
        guests: guestObjs,                        // [{ email, name, status }]
        guestEmails: guestObjs.map((g) => g.email), // kept for backward compatibility
        myStatus: statusToString(ev.getMyStatus()),
        description: ev.getDescription() || '',
        id: ev.getId(),
      };
    })
    .filter((m) => (onlyWithGuests ? m.guestCount > 0 : true))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

function toLocalDate(dateInput) {
  if (dateInput instanceof Date) return dateInput;
  const m = String(dateInput).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`Bad date "${dateInput}" — use YYYY-MM-DD, e.g. 2026-05-31.`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function statusToString(status) {
  if (!status) return '';
  const GS = CalendarApp.GuestStatus;
  switch (status) {
    case GS.YES:     return 'Going';
    case GS.NO:      return 'Declined';
    case GS.MAYBE:   return 'Maybe';
    case GS.INVITED: return 'Invited';
    case GS.OWNER:   return 'Owner';
    default:         return String(status);
  }
}

/**
 * Turn an EventGuest[] into [{ email, name, status }]. The name is read from the
 * event's own attendee record via EventGuest.getName().
 *
 * getName() returns the guest's EMAIL when the invite carries no display name
 * (per the Apps Script reference), so we treat name === email as "no name" and
 * return '' instead. The `name` key is always present — it's just empty when the
 * invite didn't include a real name. No directory / People API lookup is done.
 */
function buildGuests_(guests) {
  return guests.map((g) => {
    const email = g.getEmail();
    let name = '';
    try { name = g.getName() || ''; } catch (e) { name = ''; } // getName() can be flaky
    // getName() falls back to the email when no real name is on the invite.
    if (name && name.trim().toLowerCase() === String(email).trim().toLowerCase()) {
      name = '';
    }
    return { email: email, name: name, status: statusToString(g.getGuestStatus()) };
  });
}
