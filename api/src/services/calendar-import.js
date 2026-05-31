// Calendar import pipeline. A daily export of the user's Google Calendar (one
// JSON document per day) is POSTed here — typically by a Google Apps Script
// forwarded through a Cloudflare tunnel to POST /api/calendar-import. Unlike
// notes-import, there's NO LLM step: the calendar already gives us structured
// attendee emails, so resolution is deterministic and the whole batch runs
// synchronously, returning a per-event report the caller can show as a
// "get ready for today" summary.
//
// Per event:
//   skip if RSVP = Declined (denylist — everything else imports), skip all-day
//     →  classify each attendee email by domain:
//          internal  (a domain the user owns — see internal_domains)  → kind=internal, no account link
//          partner   (domain maps to a status=partner account, or is
//                     listed in CALENDAR_PARTNER_DOMAINS)              → kind=partner, link to that partner account
//          personal  (gmail/yahoo/… freemail)                         → skipped entirely (no contact, ignored for account-picking)
//          customer  (any other business domain)                      → kind=account, link to that domain's account
//          self      (the calendar owner)                             → skipped (never a contact for yourself)
//     →  the meeting's account = the most-attended CUSTOMER domain (internal and
//        partner attendees never decide the account). If there is no customer
//        domain at all, it's an INTERNAL note (account_id NULL, internal=true).
//     →  write the meeting via meetingsService.create, prepending the calendar
//        description (HTML → markdown) under a heading so the user can review it.
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
// 23505 we catch and report as "skipped" rather than duplicating.

import { parseEmailList } from './meetings.js';
import { slugify } from './_slug.js';
import { logger as rootLogger } from '../lib/logger.js';

const logger = rootLogger.child({ component: 'calendar-import' });

// Freemail / personal-mail providers. An attendee on one of these is skipped:
// not turned into a contact and not allowed to define an account (a gmail.com
// address must never mint a "Gmail" account). Extend per-install via
// CALENDAR_PERSONAL_DOMAINS (comma-separated) — these are merged in, never
// replaced, so the baseline can't be accidentally dropped.
const DEFAULT_PERSONAL_DOMAINS = [
  'gmail.com', 'googlemail.com',
  'yahoo.com', 'ymail.com', 'rocketmail.com',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'aim.com',
  'proton.me', 'protonmail.com', 'pm.me',
  'gmx.com', 'gmx.us', 'gmx.net', 'mail.com', 'zoho.com', 'yandex.com',
  'fastmail.com', 'hey.com', 'duck.com', 'tutanota.com', 'tuta.com',
  'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net', 'cox.net',
  'charter.net', 'bellsouth.net', 'frontier.com', 'earthlink.net',
];

function normalizeDomain(d) {
  if (!d || typeof d !== 'string') return null;
  return d.trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '') || null;
}

function normalizeEmail(e) {
  if (!e || typeof e !== 'string') return null;
  const v = e.trim().toLowerCase();
  return v.includes('@') ? v : null;
}

function envDomainSet(varName) {
  return new Set(
    (process.env[varName] || '')
      .split(',')
      .map(normalizeDomain)
      .filter(Boolean),
  );
}

// "acme-corp.com" → "Acme Corp" — a best-effort display name for an
// auto-created customer account (mirrors the helper in meetings.js).
function suggestAccountName(domain) {
  if (!domain) return '';
  const base = domain.split('.').slice(0, -1).join('.') || domain;
  return base
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Skip only the explicit "not going". Everything else — Going, Maybe/Tentative,
// Invited/NeedsAction, or an unknown/blank value — is imported. Denylist, so we
// don't have to know every label the exporter might emit.
export function isDeclined(status) {
  return String(status || '').trim().toLowerCase() === 'declined';
}

// The calendar gives times in UTC plus the calendar's timezone; the meetings
// table stores a local date. Render the event's start in the export's timezone
// so a late-evening CT meeting doesn't land on the next UTC day.
export function localDate(startIso, timezone) {
  if (typeof startIso !== 'string' || !startIso) return null;
  try {
    const d = new Date(startIso);
    if (Number.isNaN(d.getTime())) return null;
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
  } catch {
    // Bad timezone string → fall back to the UTC date.
    return startIso.slice(0, 10);
  }
}

function safeFromCodePoint(n) {
  try {
    if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return '';
    return String.fromCodePoint(n);
  } catch {
    return '';
  }
}

function stripTags(s) {
  return String(s).replace(/<[^>]+>/g, '');
}

function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#0?39;|&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_m, n) => safeFromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => safeFromCodePoint(parseInt(n, 16)));
}

// Dependency-free HTML → markdown/text. Calendar descriptions are small chunks
// of HTML (Zoom invites, agenda bullets); we don't need a full parser, just
// enough structure (headings, lists, links, line breaks) to make the result
// readable for review. Anything we can't map is stripped.
export function htmlToMarkdown(html) {
  if (!html || typeof html !== 'string') return '';
  let s = html;
  // Drop script/style outright.
  s = s.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
  // Links → [text](href).
  s = s.replace(/<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, text) => {
    const t = stripTags(text).trim();
    const h = (href || '').trim();
    if (!t) return h;
    if (!h || h.toLowerCase() === t.toLowerCase()) return t;
    return `[${t}](${h})`;
  });
  // Headings → markdown headings.
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, lvl, text) => `\n\n${'#'.repeat(Number(lvl))} ${stripTags(text).trim()}\n\n`);
  // List items → "- " bullets.
  s = s.replace(/<li\b[^>]*>/gi, '\n- ').replace(/<\/li>/gi, '');
  // Block-level closes → paragraph breaks; <br> → single newline.
  s = s.replace(/<\/(p|div|ul|ol|tr|table|blockquote|h[1-6])>/gi, '\n\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  // Strip whatever inline tags remain (<b>, <i>, <u>, <span>, …).
  s = stripTags(s);
  s = decodeEntities(s);
  // Tidy whitespace.
  return s
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .trim();
}

export class CalendarImportService {
  constructor({ meetingsService, accountsService, contactsService, internalDomainsService } = {}) {
    if (!meetingsService) throw new Error('CalendarImportService requires meetingsService');
    if (!accountsService) throw new Error('CalendarImportService requires accountsService');
    if (!contactsService) throw new Error('CalendarImportService requires contactsService');
    if (!internalDomainsService) throw new Error('CalendarImportService requires internalDomainsService');
    this.meetingsService = meetingsService;
    this.accountsService = accountsService;
    this.contactsService = contactsService;
    this.internalDomainsService = internalDomainsService;

    // Read env-driven config once. Tests can set the vars before constructing.
    this.personalDomains = new Set(DEFAULT_PERSONAL_DOMAINS);
    for (const d of envDomainSet('CALENDAR_PERSONAL_DOMAINS')) this.personalDomains.add(d);
    // Domains to force-treat as channel partners even before they exist as a
    // status=partner account in the CRM (e.g. "cdw.com"). Makes the
    // most-attended-customer rule correct out of the box for known channels.
    this.partnerDomains = envDomainSet('CALENDAR_PARTNER_DOMAINS');
    // All-day events (OOO, holidays, focus blocks) are noise by default.
    this.skipAllDay = process.env.CALENDAR_IMPORT_ALL_DAY !== 'true';
  }

  // Ingest a day's worth of calendar events. Synchronous: processes the whole
  // batch and returns a report. Never throws on a single bad event — that event
  // is reported with outcome:"error" and the rest still import.
  async importDay(userId, payload) {
    if (!payload || !Array.isArray(payload.meetings)) {
      throw Object.assign(
        new Error('Body must be { meetings: [...] } — the calendar export. Each item needs at least { id, title, start, guestEmails[], myStatus } and may carry { description, isAllDay, timezone }.'),
        { statusCode: 400 },
      );
    }

    const timezone = (typeof payload.timezone === 'string' && payload.timezone.trim()) ? payload.timezone.trim() : 'UTC';
    const selfEmail = normalizeEmail(payload.self || payload.owner || process.env.CALENDAR_SELF_EMAIL || '');
    const internalDomains = await this.internalDomainsService.getDomainSet(userId);
    const ctx = { timezone, selfEmail, internalDomains, personalDomains: this.personalDomains };

    const results = [];
    for (const m of payload.meetings) {
      let result;
      try {
        result = await this._importOne(userId, m || {}, ctx);
      } catch (err) {
        logger.error({ event: 'calendar_import.event_failed', err: err.message, stack: err.stack, title: m?.title }, 'calendar import event failed');
        result = { title: (m && typeof m.title === 'string') ? m.title : null, outcome: 'error', error: err.message };
      }
      results.push(result);
    }

    const counts = { account: 0, internal: 0, skipped: 0, error: 0 };
    let contactsCreated = 0;
    const accountsCreated = new Set();
    for (const r of results) {
      counts[r.outcome] = (counts[r.outcome] || 0) + 1;
      contactsCreated += r.contacts_created || 0;
      for (const slug of r.accounts_created || []) accountsCreated.add(slug);
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
    logger.info({ event: 'calendar_import.completed', ...counts, total: report.total, contactsCreated, accountsCreated: report.accounts_created.length }, 'calendar import completed');
    return report;
  }

  async _importOne(userId, meeting, { timezone, selfEmail, internalDomains, personalDomains }) {
    const title = (typeof meeting.title === 'string' && meeting.title.trim()) ? meeting.title.trim() : null;
    const eventId = meeting.id != null ? String(meeting.id) : null;

    if (isDeclined(meeting.myStatus)) return { title, outcome: 'skipped', reason: 'declined' };
    if (meeting.isAllDay && this.skipAllDay) return { title, outcome: 'skipped', reason: 'all_day' };

    const date = localDate(meeting.start, timezone)
      || (typeof meeting.date === 'string' ? meeting.date : null)
      || (typeof meeting.start === 'string' ? meeting.start.slice(0, 10) : null);
    if (!date) return { title, outcome: 'skipped', reason: 'no_date' };

    // Parse + classify attendees. parseEmailList dedupes and derives a name
    // guess from the local-part when no display name is present (the calendar
    // export carries bare emails).
    const parsed = parseEmailList((Array.isArray(meeting.guestEmails) ? meeting.guestEmails : []).join('\n'));
    const internalAtt = [];
    const externalByDomain = new Map(); // domain → [{email, name_guess}], insertion-ordered
    for (const p of parsed) {
      if (!p.email || !p.domain) continue;
      if (selfEmail && p.email === selfEmail) continue;          // never a contact for the owner
      if (internalDomains.has(p.domain)) { internalAtt.push(p); continue; }
      if (personalDomains.has(p.domain)) continue;               // freemail → skip entirely
      if (!externalByDomain.has(p.domain)) externalByDomain.set(p.domain, []);
      externalByDomain.get(p.domain).push(p);
    }

    // Resolve each external domain to partner vs. customer. We look it up
    // WITHOUT creating first (so partner domains never auto-create an account),
    // then only mint an account for unmatched customer domains.
    const accountsCreated = [];
    const partnerAtt = [];                 // [{email, name_guess, partnerAccountId}]
    const customerDomains = [];            // [{domain, attendees, accountId, slug, created}]
    for (const [domain, atts] of externalByDomain.entries()) {
      let existing = null;
      try { existing = await this.accountsService.getByDomain(userId, domain); } catch { existing = null; }
      const forcedPartner = this.partnerDomains.has(domain);
      const isPartner = forcedPartner || (existing && existing.status === 'partner');
      if (isPartner) {
        const partnerAccountId = (existing && existing.status === 'partner') ? existing.id : null;
        for (const a of atts) partnerAtt.push({ ...a, partnerAccountId });
        continue;
      }
      // Customer domain. Reuse an existing account; otherwise auto-create one
      // (findOrCreate flags it needs_review). fuzzy:false — the domain is the
      // identity here; we don't want a name derived from the domain to fuzzily
      // merge into an unrelated account.
      if (existing) {
        customerDomains.push({ domain, attendees: atts, accountId: existing.id, slug: existing.slug, created: false });
      } else {
        const res = await this.accountsService.findOrCreate(
          userId,
          { name: suggestAccountName(domain), domains: [domain] },
          { createIfMissing: true, fuzzy: false },
        );
        const created = res.status === 'created';
        if (created) accountsCreated.push(res.account.slug);
        customerDomains.push({ domain, attendees: atts, accountId: res.account.id, slug: res.account.slug, created });
      }
    }

    // The meeting's account = the customer domain with the most attendees.
    // Internal and partner attendees never decide this. Tie → first seen.
    let winner = null;
    for (const c of customerDomains) {
      if (!winner || c.attendees.length > winner.attendees.length) winner = c;
    }

    // Create/resolve every attendee as a contact (idempotent — dedupes across
    // events and re-runs), collecting ids to link onto the meeting.
    let contactsCreated = 0;
    const contactIds = [];
    const resolve = async (att, kind, accountId) => {
      const r = await this.contactsService.findOrCreate(
        userId,
        { full_name: att.name_guess, email: att.email, kind },
        accountId || null,
      );
      if (r.created) contactsCreated++;
      contactIds.push(r.contact.id);
    };
    for (const a of internalAtt) await resolve(a, 'internal', null);
    for (const a of partnerAtt) await resolve(a, 'partner', a.partnerAccountId);
    for (const c of customerDomains) {
      for (const a of c.attendees) await resolve(a, 'account', c.accountId);
    }

    // Account meeting iff a customer domain was present; otherwise an internal
    // note (covers internal-only AND internal+partner-only events).
    const isAccountMeeting = !!winner;
    const accountId = isAccountMeeting ? winner.accountId : null;
    const internal = !isAccountMeeting;
    const needsReview = isAccountMeeting ? !!winner.created : false;

    // Body: calendar description (HTML → markdown) at the top for review. body
    // is NOT NULL, so fall back to a placeholder when there's no description.
    const descMd = htmlToMarkdown(meeting.description || '');
    let body = descMd ? `## Calendar description\n\n${descMd}\n` : '';
    if (!body.trim()) body = '_Imported from calendar — no description provided._';

    // Stable, event-id-derived filename → re-importing the same day is a no-op
    // (collides on the meetings unique index) instead of duplicating.
    const filename = eventId ? `cal-${eventId}` : `cal-${date}-${slugify(title || 'meeting')}`;

    try {
      const row = await this.meetingsService.create(userId, accountId, {
        date,
        title,
        filename,
        body,
        internal,
        needs_review: needsReview,
        contact_ids: contactIds,
      });
      return {
        title,
        outcome: isAccountMeeting ? 'account' : 'internal',
        meeting_id: row.id,
        date,
        account_slug: isAccountMeeting ? winner.slug : null,
        account_created: isAccountMeeting ? winner.created : false,
        needs_review: needsReview,
        attendees: contactIds.length,
        contacts_created: contactsCreated,
        accounts_created: accountsCreated,
      };
    } catch (err) {
      if (err.code === '23505') {
        return {
          title,
          outcome: 'skipped',
          reason: 'duplicate',
          note: 'A meeting from this calendar event already exists (matched on event id) — left as-is.',
          accounts_created: accountsCreated,
          contacts_created: contactsCreated,
        };
      }
      throw err;
    }
  }
}
