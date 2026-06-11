// Calendar import pipeline. A daily export of the user's Google Calendar (one
// JSON document per day) is POSTed here — typically by a Google Apps Script
// forwarded through a Cloudflare tunnel to POST /api/calendar-import. Unlike
// notes-import, there's NO LLM step: the calendar already gives us structured
// attendee emails, so resolution is deterministic and the whole batch runs
// synchronously, returning a per-event report the caller can show as a
// "get ready for today" summary.
//
// Per event:
//   skip if RSVP = Declined (denylist — everything else imports), skip all-day,
//   skip "organizer-only" holds (no guest but yourself — focus time, lunch, DND)
//     →  classify each attendee email by domain:
//          internal  (a domain the user owns — see internal_domains)  → kind=internal, no account link
//          partner   (domain maps to a status=partner account, or is
//                     listed in CALENDAR_PARTNER_DOMAINS)              → kind=partner, link to that partner account
//          personal  (gmail/yahoo/… freemail)                         → skipped entirely (no contact, ignored for account-picking)
//          customer  (any other business domain)                      → kind=account, link to that domain's account
//          self      (the calendar owner)                             → skipped (never a contact for yourself)
//     →  each linked attendee also records their RSVP/attendance status
//        (going/declined/maybe/invited/owner) on the meeting_attendees join row,
//        taken from the guest's status in the structured guests[] payload.
//     →  the meeting's account = the most-attended CUSTOMER domain (internal and
//        partner attendees never decide the account). If there is no customer
//        domain at all, it's an INTERNAL note (account_id NULL, internal=true).
//     →  write the meeting via meetingsService.create, prepending the calendar
//        description (HTML → markdown) under a heading so the user can review it.
//        The event's start/end (full ISO instants the export already sends) are
//        persisted as meetings.starts_at/ends_at to drive the Today timeline, and
//        its `location` (Meet/Zoom URL or room) as meetings.location for the
//        timeline's "Join" button; `date` (above) stays the grouping/display day.
//
// Account resolution honours the "separate creation from assignment" model the
// import-triage refactor built: an unknown customer domain auto-creates an
// account flagged needs_review (the meeting inherits needs_review only when its
// winning account was just minted — confident/existing matches import clean).
//
// Re-import is idempotent: the meeting filename is derived from the calendar
// event id (stable across daily runs, including recurring-instance ids), and
// meetings has unique indexes on (account_id, filename) and
// (user_id, filename WHERE account_id IS NULL), so re-sending a day trips a
// 23505 we catch and report as "skipped" rather than duplicating. On that skip
// we still backfill starts_at/ends_at onto the existing row when it lacks them
// (COALESCE — never overwrites), so re-running today's import lights up the
// Today timeline for rows imported before time-of-day capture existed.

import { parseEmailList, normalizeEmail } from "../_shared/_email.js";
import {
    envDomainSet,
    suggestAccountName,
    normalizeDomain,
} from "../_shared/_domain.js";
import { htmlToMarkdown } from "../_shared/_html.js";
import { slugify, deriveFilename } from "../_shared/_slug.js";
import { badRequest } from "../../lib/http-error.js";
import { logger as rootLogger } from "../../lib/logger.js";

const logger = rootLogger.child({ component: "calendar-import" });

// ── Calendar payload shapes ──────────────────────────────────────────────
// Deliberately permissive: the exporter sends loosely-structured JSON and the
// parsing code narrows each field defensively. These describe only the fields
// this service reads; unknown extras pass through untouched.
interface CalendarGuest {
    email?: unknown;
    name?: unknown;
    status?: unknown;
}
interface CalendarMeeting {
    id?: unknown;
    title?: unknown;
    provider?: unknown;
    myStatus?: unknown;
    isAllDay?: unknown;
    start?: unknown;
    end?: unknown;
    date?: unknown;
    location?: unknown;
    description?: unknown;
    guests?: unknown;
    guestEmails?: unknown;
    [key: string]: unknown;
}
interface CalendarPayload {
    meetings?: unknown;
    timezone?: unknown;
    self?: unknown;
    owner?: unknown;
    date?: unknown;
}

// One parsed attendee for an event: the deduped { email, domain, name_guess }
// record from _email plus the per-guest RSVP status this service attaches.
interface Attendee {
    email: string;
    domain: string | null;
    name_guess: string | null;
    status: string | null;
}

// An attendee on a partner domain, tagged with the resolved partner account id
// (null when the domain is only force-flagged via CALENDAR_PARTNER_DOMAINS).
interface PartnerAttendee extends Attendee {
    partnerAccountId: number | null;
}

// A resolved external customer domain and its attendees, with the account it
// maps to (existing or just-created).
interface CustomerDomain {
    domain: string;
    attendees: Attendee[];
    accountId: number;
    slug: string;
    created: boolean;
}

// Per-event ingestion context computed once in importDay and threaded into
// _importOne.
interface ImportContext {
    timezone: string;
    selfEmail: string | null;
    internalDomains: Set<string>;
    personalDomains: Set<string>;
}

// The per-event report object. A union of the skip / success / duplicate / error
// shapes _importOne (and importDay's catch) can produce — modelled as one
// superset with everything past `outcome` optional, so each return site is
// assignable and the rollup in importDay can read any field.
interface ImportResult {
    title: string | null;
    outcome: string;
    reason?: string;
    error?: string;
    meeting_id?: number;
    date?: string | null;
    account_slug?: string | null;
    account_created?: boolean;
    needs_review?: boolean;
    attendees?: number;
    contacts_created?: number;
    accounts_created?: string[];
    note?: string;
    backfilled?: boolean;
}

// Minimal shapes for the injected sibling services. This file only touches the
// members listed here; the real services are richer. Returns stay loose (`any`)
// because they're pg-row-shaped and not type-checked at the boundary.
interface MeetingsServiceLike {
    create(userId: number, accountId: number | null, data: unknown): Promise<any>;
    backfillCalendarFields(
        userId: number,
        filename: string,
        accountId: number | null,
        fields: unknown,
    ): Promise<any>;
}
interface AccountsServiceLike {
    getByDomain(userId: number, domain: string): Promise<any>;
    findOrCreate(userId: number, data: unknown, opts: unknown): Promise<any>;
}
interface ContactsServiceLike {
    findOrCreate(
        userId: number,
        data: unknown,
        accountId: number | null,
    ): Promise<any>;
}
interface InternalDomainsServiceLike {
    getDomainSet(userId: number): Promise<Set<string>>;
}

// Freemail / personal-mail providers. An attendee on one of these is skipped:
// not turned into a contact and not allowed to define an account (a gmail.com
// address must never mint a "Gmail" account). Extend per-install via
// CALENDAR_PERSONAL_DOMAINS (comma-separated) — these are merged in, never
// replaced, so the baseline can't be accidentally dropped.
const DEFAULT_PERSONAL_DOMAINS = [
    "gmail.com",
    "googlemail.com",
    "yahoo.com",
    "ymail.com",
    "rocketmail.com",
    "outlook.com",
    "hotmail.com",
    "live.com",
    "msn.com",
    "icloud.com",
    "me.com",
    "mac.com",
    "aol.com",
    "aim.com",
    "proton.me",
    "protonmail.com",
    "pm.me",
    "gmx.com",
    "gmx.us",
    "gmx.net",
    "mail.com",
    "zoho.com",
    "yandex.com",
    "fastmail.com",
    "hey.com",
    "duck.com",
    "tutanota.com",
    "tuta.com",
    "comcast.net",
    "verizon.net",
    "att.net",
    "sbcglobal.net",
    "cox.net",
    "charter.net",
    "bellsouth.net",
    "frontier.com",
    "earthlink.net",
];

// Skip only the explicit "not going". Everything else — Going, Maybe/Tentative,
// Invited/NeedsAction, or an unknown/blank value — is imported. Denylist, so we
// don't have to know every label the exporter might emit.
export function isDeclined(status: unknown) {
    return (
        String(status || "")
            .trim()
            .toLowerCase() === "declined"
    );
}

// Map a guest's RSVP/attendance response to a canonical lowercase token (the set
// meeting_attendees.status is CHECK-constrained to), or null when blank /
// unrecognized. The export uses the human labels "Going" | "Declined" | "Maybe"
// | "Invited" | "Owner"; we also accept the raw Google API values so the import
// doesn't care which the exporter sends. Same denylist philosophy as isDeclined:
// anything we don't recognize collapses to null (records no status) rather than
// risking a constraint violation, so a new label can never break an import.
const ATTENDEE_STATUS_ALIASES: Record<string, string> = {
    going: "going",
    yes: "going",
    accepted: "going",
    declined: "declined",
    no: "declined",
    maybe: "maybe",
    tentative: "maybe",
    invited: "invited",
    needsaction: "invited",
    notresponded: "invited",
    awaitingresponse: "invited",
    owner: "owner",
    organizer: "owner",
};
export function normalizeAttendeeStatus(status: unknown) {
    // Collapse to letters only so "needs action" / "needs-action" / "needsAction"
    // all key the same alias.
    const v = String(status || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z]/g, "");
    if (!v) return null;
    return ATTENDEE_STATUS_ALIASES[v] || null;
}

// Build the deduped attendee list for one event. The structured guests[] form —
// { email, name, status } — is preferred: it carries each guest's real display
// name (no longer guessed from the email local-part) and their RSVP, so we can
// both name the contact correctly and record per-attendee attendance. Older
// exports that only send the flat guestEmails[] still work (no names, no
// status). Returns [{ email, domain, name_guess, status }], deduped by email.
export function buildAttendees(meeting: CalendarMeeting): Attendee[] {
    if (Array.isArray(meeting.guests) && meeting.guests.length) {
        const byEmail = new Map<string, Attendee>();
        for (const g of meeting.guests as CalendarGuest[]) {
            const email = normalizeEmail(g?.email);
            if (!email) continue;
            const domain = normalizeDomain(email.split("@")[1]);
            const name =
                typeof g?.name === "string" && g.name.trim()
                    ? g.name.trim()
                    : null;
            const status = normalizeAttendeeStatus(g?.status);
            const prev = byEmail.get(email);
            if (prev) {
                if (!prev.name_guess && name) prev.name_guess = name; // keep the first known name
                if (!prev.status && status) prev.status = status; // keep the first known status
            } else {
                byEmail.set(email, { email, domain, name_guess: name, status });
            }
        }
        return [...byEmail.values()];
    }
    // Fallback: flat guestEmails[] (legacy export shape — no names, no status).
    return parseEmailList(
        (Array.isArray(meeting.guestEmails) ? meeting.guestEmails : []).join(
            "\n",
        ),
    ).map((p) => ({ ...p, status: null }));
}

// The calendar gives times in UTC plus the calendar's timezone; the meetings
// table stores a local date. Render the event's start in the export's timezone
// so a late-evening CT meeting doesn't land on the next UTC day.
export function localDate(startIso: unknown, timezone: string | null | undefined) {
    if (typeof startIso !== "string" || !startIso) return null;
    try {
        const d = new Date(startIso);
        if (Number.isNaN(d.getTime())) return null;
        // en-CA formats as YYYY-MM-DD.
        return new Intl.DateTimeFormat("en-CA", {
            timeZone: timezone || "UTC",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).format(d);
    } catch {
        // Bad timezone string → fall back to the UTC date.
        return startIso.slice(0, 10);
    }
}

// Validate an ISO 8601 timestamp from the calendar export (event start/end). The
// export sends both as full UTC instants (e.g. "2026-05-31T13:30:00.000Z"); we
// persist them verbatim as timestamptz so the GUI renders them in the viewer's
// local zone and can place the event on the Today timeline. Returns the original
// string when it parses, else null — a bad/blank value just means "no time of
// day", never a hard failure.
export function parseTimestamp(iso: unknown) {
    if (typeof iso !== "string" || !iso.trim()) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : iso;
}

export class CalendarImportService {
    meetingsService: MeetingsServiceLike;
    accountsService: AccountsServiceLike;
    contactsService: ContactsServiceLike;
    internalDomainsService: InternalDomainsServiceLike;
    personalDomains: Set<string>;
    partnerDomains: Set<string>;
    skipAllDay: boolean;
    skipSolo: boolean;

    constructor({
        meetingsService,
        accountsService,
        contactsService,
        internalDomainsService,
    }: {
        meetingsService?: MeetingsServiceLike;
        accountsService?: AccountsServiceLike;
        contactsService?: ContactsServiceLike;
        internalDomainsService?: InternalDomainsServiceLike;
    } = {}) {
        if (!meetingsService)
            throw new Error("CalendarImportService requires meetingsService");
        if (!accountsService)
            throw new Error("CalendarImportService requires accountsService");
        if (!contactsService)
            throw new Error("CalendarImportService requires contactsService");
        if (!internalDomainsService)
            throw new Error(
                "CalendarImportService requires internalDomainsService",
            );
        this.meetingsService = meetingsService;
        this.accountsService = accountsService;
        this.contactsService = contactsService;
        this.internalDomainsService = internalDomainsService;

        // Read env-driven config once. Tests can set the vars before constructing.
        this.personalDomains = new Set(DEFAULT_PERSONAL_DOMAINS);
        for (const d of envDomainSet("CALENDAR_PERSONAL_DOMAINS"))
            this.personalDomains.add(d);
        // Domains to force-treat as channel partners even before they exist as a
        // status=partner account in the CRM (e.g. "cdw.com"). Makes the
        // most-attended-customer rule correct out of the box for known channels.
        this.partnerDomains = envDomainSet("CALENDAR_PARTNER_DOMAINS");
        // All-day events (OOO, holidays, focus blocks) are noise by default.
        this.skipAllDay = process.env.CALENDAR_IMPORT_ALL_DAY !== "true";
        // "Organizer-only" holds (no guest but yourself — focus time, lunch, DND
        // blocks, reminders) aren't meetings; skip by default. Opt in to importing
        // them with CALENDAR_IMPORT_SOLO=true.
        this.skipSolo = process.env.CALENDAR_IMPORT_SOLO !== "true";
    }

    // Ingest a day's worth of calendar events. Synchronous: processes the whole
    // batch and returns a report. Never throws on a single bad event — that event
    // is reported with outcome:"error" and the rest still import.
    async importDay(userId: number, payload: CalendarPayload) {
        if (!payload || !Array.isArray(payload.meetings)) {
            throw badRequest(
                "Body must be { meetings: [...] } — the calendar export. Each item needs at least { id, title, start, guestEmails[], myStatus } and may carry { description, isAllDay, timezone }.",
            );
        }

        const timezone =
            typeof payload.timezone === "string" && payload.timezone.trim()
                ? payload.timezone.trim()
                : "UTC";
        const selfEmail = normalizeEmail(
            payload.self ||
                payload.owner ||
                process.env.CALENDAR_SELF_EMAIL ||
                "",
        );
        const internalDomains =
            await this.internalDomainsService.getDomainSet(userId);
        const ctx: ImportContext = {
            timezone,
            selfEmail,
            internalDomains,
            personalDomains: this.personalDomains,
        };

        const results: ImportResult[] = [];

        logger.info(
            {
                event: "import_meetings_start",
                component: "meeting_importer",
                userId: userId,
                meetingCount: payload.meetings.length,
            },
            `Importing ${payload.meetings.length} meetings for user ${userId}`,
        );

        for (const m of payload.meetings) {
            logger.info(
                {
                    event: "import_meeting_item",
                    component: "meeting_importer",
                    userId: userId,
                    meetingId: m.id, // Assumes your meeting object has an 'id' property
                    meetingProvider: m.provider, // Optional: helpful if you have Zoom vs Google Meet etc.
                    meetingKeys: Object.keys(m),
                    meetingData: m, // Pass the raw object instead of stringifying
                },
                `Adding meeting ${m.id || "item"} for user ${userId}`,
            );

            let result: ImportResult;
            try {
                result = await this._importOne(userId, m || {}, ctx);
            } catch (err) {
                logger.error(
                    {
                        event: "calendar_import.event_failed",
                        err: (err as Error).message,
                        stack: (err as Error).stack,
                        title: m?.title,
                    },
                    "calendar import event failed",
                );
                result = {
                    title: m && typeof m.title === "string" ? m.title : null,
                    outcome: "error",
                    error: (err as Error).message,
                };
            }
            results.push(result);
        }

        const counts: Record<string, number> = { account: 0, internal: 0, skipped: 0, error: 0 };
        let contactsCreated = 0;
        const accountsCreated = new Set<string>();
        for (const r of results) {
            counts[r.outcome] = (counts[r.outcome] || 0) + 1;
            contactsCreated += r.contacts_created || 0;
            for (const slug of r.accounts_created || [])
                accountsCreated.add(slug);
        }

        const report = {
            date: payload.date || null,
            timezone,
            self: selfEmail || null,
            total: payload.meetings.length,
            imported: counts.account + counts.internal,
            account_meetings: counts.account,
            internal_notes: counts.internal,
            skipped: counts.skipped,
            errors: counts.error,
            contacts_created: contactsCreated,
            accounts_created: [...accountsCreated],
            results,
        };
        logger.info(
            {
                event: "calendar_import.completed",
                ...counts,
                total: report.total,
                contactsCreated,
                accountsCreated: report.accounts_created.length,
            },
            "calendar import completed",
        );
        return report;
    }

    async _importOne(
        userId: number,
        meeting: CalendarMeeting,
        { timezone, selfEmail, internalDomains, personalDomains }: ImportContext,
    ): Promise<ImportResult> {
        const title =
            typeof meeting.title === "string" && meeting.title.trim()
                ? meeting.title.trim()
                : null;
        const eventId = meeting.id != null ? String(meeting.id) : null;

        if (isDeclined(meeting.myStatus))
            return { title, outcome: "skipped", reason: "declined" };
        if (meeting.isAllDay && this.skipAllDay)
            return { title, outcome: "skipped", reason: "all_day" };

        const date =
            localDate(meeting.start, timezone) ||
            (typeof meeting.date === "string" ? meeting.date : null) ||
            (typeof meeting.start === "string"
                ? meeting.start.slice(0, 10)
                : null);
        if (!date) return { title, outcome: "skipped", reason: "no_date" };

        // Keep the precise instants too (the export already sends both as ISO
        // UTC). `date` above stays the grouping/display day; these power the
        // Today timeline and the "happening now" highlight. Drop a non-sensical
        // end (<= start) rather than store an inverted block.
        const startsAt = parseTimestamp(meeting.start);
        let endsAt = parseTimestamp(meeting.end);
        if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt))
            endsAt = null;
        // The export puts the conferencing URL (Meet/Zoom/Teams) — or a room /
        // address for in-person — in `location`. Kept verbatim; the GUI decides
        // whether it's a join link or plain text.
        const location =
            typeof meeting.location === "string" && meeting.location.trim()
                ? meeting.location.trim()
                : null;

        // Parse + classify attendees. buildAttendees prefers the structured guests[]
        // (real display name + RSVP status per guest) and falls back to the flat
        // guestEmails[] for older exports; both are deduped by email.
        const parsed = buildAttendees(meeting);

        // "Blocking the calendar" holds — focus time, lunch, DND, reminders — have
        // no guest other than the organizer (you). They aren't meetings, so by
        // default we skip them instead of letting them pile up as empty internal
        // notes (and clutter the Today timeline). Any event with even one other
        // attendee — internal teammate or external — is kept. With selfEmail
        // unknown we can still catch the zero-guest case.
        const hasOtherAttendee = parsed.some(
            (p) => p.email && (!selfEmail || p.email !== selfEmail),
        );
        if (this.skipSolo && !hasOtherAttendee) {
            return { title, outcome: "skipped", reason: "organizer_only" };
        }

        const internalAtt: Attendee[] = [];
        const externalByDomain = new Map<string, Attendee[]>(); // domain → [{email, name_guess}], insertion-ordered
        for (const p of parsed) {
            if (!p.email || !p.domain) continue;
            if (selfEmail && p.email === selfEmail) continue; // never a contact for the owner
            if (internalDomains.has(p.domain)) {
                internalAtt.push(p);
                continue;
            }
            if (personalDomains.has(p.domain)) continue; // freemail → skip entirely
            if (!externalByDomain.has(p.domain))
                externalByDomain.set(p.domain, []);
            externalByDomain.get(p.domain)!.push(p);
        }

        // Resolve each external domain to partner vs. customer. We look it up
        // WITHOUT creating first (so partner domains never auto-create an account),
        // then only mint an account for unmatched customer domains.
        const accountsCreated: string[] = [];
        const partnerAtt: PartnerAttendee[] = []; // [{email, name_guess, partnerAccountId}]
        const customerDomains: CustomerDomain[] = []; // [{domain, attendees, accountId, slug, created}]
        for (const [domain, atts] of externalByDomain.entries()) {
            let existing: any = null;
            try {
                existing = await this.accountsService.getByDomain(
                    userId,
                    domain,
                );
            } catch {
                existing = null;
            }
            const forcedPartner = this.partnerDomains.has(domain);
            const isPartner =
                forcedPartner || (existing && existing.status === "partner");
            if (isPartner) {
                const partnerAccountId =
                    existing && existing.status === "partner"
                        ? existing.id
                        : null;
                for (const a of atts)
                    partnerAtt.push({ ...a, partnerAccountId });
                continue;
            }
            // Customer domain. Reuse an existing account; otherwise auto-create one
            // (findOrCreate flags it needs_review). fuzzy:false — the domain is the
            // identity here; we don't want a name derived from the domain to fuzzily
            // merge into an unrelated account.
            if (existing) {
                customerDomains.push({
                    domain,
                    attendees: atts,
                    accountId: existing.id,
                    slug: existing.slug,
                    created: false,
                });
            } else {
                const res = await this.accountsService.findOrCreate(
                    userId,
                    { name: suggestAccountName(domain), domains: [domain] },
                    { createIfMissing: true, fuzzy: false },
                );
                const created = res.status === "created";
                if (created) accountsCreated.push(res.account.slug);
                customerDomains.push({
                    domain,
                    attendees: atts,
                    accountId: res.account.id,
                    slug: res.account.slug,
                    created,
                });
            }
        }

        // The meeting's account = the customer domain with the most attendees.
        // Internal and partner attendees never decide this. Tie → first seen.
        let winner: CustomerDomain | null = null;
        for (const c of customerDomains) {
            if (!winner || c.attendees.length > winner.attendees.length)
                winner = c;
        }

        // Create/resolve every attendee as a contact (idempotent — dedupes across
        // events and re-runs), collecting ids to link onto the meeting plus each
        // one's RSVP status. The real display name from guests[] now flows into
        // findOrCreate, so an attendee who was previously stored email-only gets
        // named. Dedupe the linked ids: two different invite addresses can resolve
        // to the same contact, and the meeting_attendees (meeting_id, contact_id)
        // unique index would otherwise reject the second link (and surface as a
        // misleading "duplicate meeting" via the 23505 handler below).
        let contactsCreated = 0;
        const contactIds: number[] = [];
        const seenContactIds = new Set<string>();
        const attendeeStatus: Record<string, string> = {}; // String(contactId) → canonical status
        const resolve = async (att: Attendee, kind: string, accountId: number | null) => {
            const r = await this.contactsService.findOrCreate(
                userId,
                { full_name: att.name_guess, email: att.email, kind },
                accountId || null,
            );
            if (r.created) contactsCreated++;
            const cid = String(r.contact.id);
            if (!seenContactIds.has(cid)) {
                seenContactIds.add(cid);
                contactIds.push(r.contact.id);
            }
            // First non-null status wins; a later blank/duplicate won't clear it.
            if (att.status && !attendeeStatus[cid])
                attendeeStatus[cid] = att.status;
        };
        for (const a of internalAtt) await resolve(a, "internal", null);
        for (const a of partnerAtt)
            await resolve(a, "partner", a.partnerAccountId);
        for (const c of customerDomains) {
            for (const a of c.attendees)
                await resolve(a, "account", c.accountId);
        }

        // Account meeting iff a customer domain was present; otherwise an internal
        // note (covers internal-only AND internal+partner-only events).
        const isAccountMeeting = !!winner;
        const accountId = isAccountMeeting ? winner!.accountId : null;
        const internal = !isAccountMeeting;
        const needsReview = isAccountMeeting ? !!winner!.created : false;

        // Body: calendar description (HTML → markdown) at the top for review. body
        // is NOT NULL, so fall back to a placeholder when there's no description.
        const descMd = htmlToMarkdown(meeting.description || "");
        let body = descMd ? `## Calendar description\n\n${descMd}\n` : "";
        if (!body.trim())
            body = "_Imported from calendar — no description provided._";

        // Stable, event-id-derived filename → re-importing the same day is a no-op
        // (collides on the meetings unique index) instead of duplicating.
        const filename = eventId
            ? `cal-${eventId}`
            : `cal-${date}-${slugify(title || "meeting")}`;
        // meetingsService.create slugifies + ".md"-suffixes this via deriveFilename
        // before storing (a real event id like "abc@google.com" becomes
        // "cal-abc-google-com.md"). The 23505 backfill below matches on the value
        // AS STORED, so derive it here the same way create does — passing the raw
        // `filename` to the backfill would match zero rows.
        const storedFilename = deriveFilename(date, title, filename);

        try {
            const row = await this.meetingsService.create(userId, accountId, {
                date,
                starts_at: startsAt,
                ends_at: endsAt,
                location,
                title,
                filename,
                body,
                internal,
                needs_review: needsReview,
                contact_ids: contactIds,
                attendee_status: attendeeStatus,
            });
            return {
                title,
                outcome: isAccountMeeting ? "account" : "internal",
                meeting_id: row.id,
                date,
                account_slug: isAccountMeeting ? winner!.slug : null,
                account_created: isAccountMeeting ? winner!.created : false,
                needs_review: needsReview,
                attendees: contactIds.length,
                contacts_created: contactsCreated,
                accounts_created: accountsCreated,
            };
        } catch (err) {
            if ((err as { code?: string }).code === "23505") {
                // A meeting from this event already exists (matched on the stable
                // event-id filename). Don't duplicate — but DO backfill start/end
                // times if we now have them and the stored row predates time
                // capture. backfillTimes COALESCE-fills blanks only, so it never
                // clobbers a time the user edited. This is what lets a re-run of
                // today's import light up the Today timeline for rows imported
                // earlier today (before this row existed).
                let backfilled = false;
                if (startsAt || endsAt || location) {
                    try {
                        // Target the stored (slugified, ".md") filename and scope to
                        // the SAME account partition the insert collided with
                        // (accountId, or null for an internal note) so the COALESCE
                        // fill can only touch the exact row a re-import duplicated.
                        const updated = await this.meetingsService.backfillCalendarFields(
                            userId,
                            storedFilename,
                            accountId,
                            { starts_at: startsAt, ends_at: endsAt, location },
                        );
                        backfilled = !!updated;
                    } catch {
                        // Best-effort — a failed backfill must not turn a clean
                        // skip into a hard error for the whole event.
                    }
                }
                return {
                    title,
                    outcome: "skipped",
                    reason: "duplicate",
                    note: "A meeting from this calendar event already exists (matched on event id) — left as-is.",
                    backfilled,
                    accounts_created: accountsCreated,
                    contacts_created: contactsCreated,
                };
            }
            throw err;
        }
    }
}
