// Krisp webhook → email. Krisp fires a webhook when a meeting's notes /
// transcript / outline are generated and POSTs JSON (see krisp/README.md for the
// confirmed shape). The NOTES delivery is emailed to you through Gmail SMTP with
// an App Password (no Google Cloud project); transcript / outline deliveries are
// acknowledged and ignored, so each meeting sends one email. Nothing is written
// to the CRM.
//
// Config (env, read once at boot by emailConfigFromEnv):
//   GMAIL_USER          the Gmail account it sends from (and logs in as)
//   GMAIL_APP_PASSWORD  that account's App Password — spaces are stripped
//   KRISP_EMAIL_TO      recipient; defaults to GMAIL_USER (you email yourself)
//   KRISP_EMAIL_TZ      timezone for the meeting date/time (default America/New_York)
// Missing Gmail config ⇒ a notes delivery fails with 503, so the gap is visible
// instead of the notes silently vanishing.
//
// Not deduplicated: a re-sent event emails again. Synchronous, deterministic,
// no LLM.

import nodemailer from 'nodemailer';
import { httpError } from '../../lib/http-error.js';
import { logger as rootLogger } from '../../lib/logger.js';

const logger = rootLogger.child({ component: 'krisp-webhook' });

// Normalized view of one Krisp delivery.
interface ParsedKrisp {
  eventType: string; // canonical: note | transcript | outline
  krispMeetingId: string | null;
  title: string | null;
  startsAt: string | null; // ISO instant
  endsAt: string | null;
  url: string | null; // the meeting's page in Krisp
  content: string; // markdown body for this event
}

export interface KrispEmailConfig {
  user: string | null; // GMAIL_USER — sender and SMTP login
  pass: string | null; // GMAIL_APP_PASSWORD, whitespace removed
  to: string | null; // KRISP_EMAIL_TO, else GMAIL_USER
  timeZone: string; // KRISP_EMAIL_TZ, else DEFAULT_TZ
}

// The one transport method we call — injectable so tests never touch SMTP.
interface MailTransport {
  sendMail(message: {
    from: { name: string; address: string };
    to: string;
    subject: string;
    text: string;
  }): Promise<{ messageId?: string }>;
}

interface IngestResult {
  ok: true;
  event: string;
  krisp_meeting_id: string | null;
  outcome: 'emailed' | 'ignored';
  message_id?: string;
}

const DEFAULT_TZ = 'America/New_York';
const MAX_RAW_FALLBACK = 20000;

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function parseTs(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : s;
}

function safeJson(v: unknown): string {
  try {
    const s = JSON.stringify(v, null, 2);
    return s.length > MAX_RAW_FALLBACK ? `${s.slice(0, MAX_RAW_FALLBACK)}\n… (truncated)` : s;
  } catch {
    return String(v);
  }
}

// "note_generated" → note, "transcript_generated" → transcript, etc. Denylist
// philosophy: an unrecognized label collapses to "note", so a new trigger name
// still gets emailed rather than dropped.
function canonicalEvent(raw: string | null): string {
  const v = (raw || '').toLowerCase();
  if (v.includes('transcript')) return 'transcript';
  if (v.includes('outline')) return 'outline';
  return 'note';
}

// Krisp pre-renders clean markdown in data.raw_content — prefer it verbatim. Fall
// back to a JSON dump of the data block so nothing is lost if the field is ever
// absent (and so the real shape surfaces in the email for us to refine against).
function buildContent(data: Record<string, unknown>): string {
  const raw = str(data.raw_content) || str(data.rawContent);
  if (raw) return raw;
  return `\`\`\`json\n${safeJson(data)}\n\`\`\``;
}

export function parseKrisp(raw: unknown): ParsedKrisp {
  const root = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const data = (root.data && typeof root.data === 'object' ? root.data : root) as Record<string, unknown>;
  const meeting = (data.meeting && typeof data.meeting === 'object' ? data.meeting : {}) as Record<string, unknown>;

  return {
    eventType: canonicalEvent(str(root.event) || str(data.event) || str(root.type)),
    // The MEETING id (stable across a meeting's 2–3 events) — NOT root.id, which
    // is the per-delivery event id.
    krispMeetingId: str(meeting.id) || str(data.meeting_id) || str(meeting.uuid),
    title: str(meeting.title) || str(meeting.name) || str(data.title),
    startsAt: parseTs(meeting.start_date) || parseTs(meeting.start_time) || parseTs(meeting.start),
    endsAt: parseTs(meeting.end_date) || parseTs(meeting.end_time) || parseTs(meeting.end),
    url: str(meeting.url),
    content: buildContent(data),
  };
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function emailConfigFromEnv(env: NodeJS.ProcessEnv = process.env): KrispEmailConfig {
  const user = str(env.GMAIL_USER);
  // Google displays the App Password as four groups of four; the spaces aren't
  // part of it, and an unquoted .env value keeps them.
  const pass = (env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '') || null;
  let timeZone = str(env.KRISP_EMAIL_TZ) || DEFAULT_TZ;
  if (!isValidTimeZone(timeZone)) {
    logger.warn({ event: 'krisp_webhook.bad_timezone', timeZone }, `KRISP_EMAIL_TZ "${timeZone}" is not an IANA timezone — using ${DEFAULT_TZ}`);
    timeZone = DEFAULT_TZ;
  }
  return { user, pass, to: str(env.KRISP_EMAIL_TO) || user, timeZone };
}

// Subject + plain-text body for one notes delivery. Krisp's raw_content is
// already readable markdown, so it goes in verbatim under a short header. Dates
// render in the configured timezone — in UTC an evening meeting would land on
// the next day.
export function buildEmail(p: ParsedKrisp, timeZone: string): { subject: string; text: string } {
  const title = p.title || 'Untitled meeting';
  const start = p.startsAt ? new Date(p.startsAt) : null;
  const day = start && new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric', year: 'numeric' }).format(start);
  const when = start && new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(start);
  const header = [title, when && `Started: ${when}`, p.url && `Krisp: ${p.url}`].filter(Boolean).join('\n');
  return {
    subject: day ? `Krisp notes: ${title} (${day})` : `Krisp notes: ${title}`,
    text: `${header}\n\n${p.content.trim()}\n`,
  };
}

export class KrispWebhookService {
  config: KrispEmailConfig;
  transport: MailTransport | null;

  constructor({ config = emailConfigFromEnv(), transport }: { config?: KrispEmailConfig; transport?: MailTransport } = {}) {
    this.config = config;
    this.transport = transport
      ?? (config.user && config.pass
        ? nodemailer.createTransport({ service: 'gmail', auth: { user: config.user, pass: config.pass } })
        : null);
  }

  async ingest(raw: unknown): Promise<IngestResult> {
    const p = parseKrisp(raw);
    const base = { ok: true as const, event: p.eventType, krisp_meeting_id: p.krispMeetingId };

    // One email per meeting: only the notes delivery mails. Transcript / outline
    // still get a 200 so Krisp doesn't count them as failed deliveries.
    if (p.eventType !== 'note') {
      logger.info({ event: 'krisp_webhook.ignored', krispEvent: p.eventType }, `krisp ${p.eventType} ignored — only notes are emailed`);
      return { ...base, outcome: 'ignored' };
    }

    const { user, to, timeZone } = this.config;
    if (!this.transport || !user || !to) {
      throw httpError(503, 'Krisp email is not configured: set GMAIL_USER and GMAIL_APP_PASSWORD.');
    }

    const { subject, text } = buildEmail(p, timeZone);
    let info: { messageId?: string };
    try {
      info = await this.transport.sendMail({ from: { name: 'Krisp notes', address: user }, to, subject, text });
    } catch (err) {
      // nodemailer's code says which side failed: EAUTH = Gmail rejected the
      // login (wrong/revoked App Password), ECONNECTION / ETIMEDOUT = network.
      const e = err as { code?: string; message?: string };
      logger.error({ event: 'krisp_webhook.email_failed', code: e.code, err: e.message }, 'sending the krisp email failed');
      throw httpError(502, `Sending the Krisp email failed${e.code ? ` (${e.code})` : ''}.`);
    }
    logger.info({ event: 'krisp_webhook.emailed', krispMeetingId: p.krispMeetingId, messageId: info.messageId }, `krisp notes emailed: ${subject}`);
    return { ...base, outcome: 'emailed', message_id: info.messageId };
  }
}
