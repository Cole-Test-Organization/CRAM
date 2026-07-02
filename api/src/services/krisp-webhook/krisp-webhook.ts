// Krisp webhook importer. Krisp fires a webhook when a meeting's notes /
// transcript / outline are generated and POSTs JSON (see krisp/README.md for the
// confirmed shape). We turn that into CRM meeting content.
//
// The meeting almost always ALREADY EXISTS — calendar-import created it from
// Google Calendar — so this does NOT resolve an account from emails (a Krisp
// payload carries none we can trust; Krisp isn't wired to the calendar). Instead:
//
//   1. single time-proximity match  — find the one existing meeting whose start
//                                      is within ±window of Krisp's start. Append
//                                      the notes cleanly.
//   2. multiple time matches        — append to the best candidate when there is
//                                      a clear winner, but flag needs_review so
//                                      the user verifies; if there is no clear
//                                      winner, park a new review row.
//   3. prior Krisp import fallback  — if time is absent/ambiguous but a previous
//                                      Krisp delivery already parked this meeting,
//                                      append to that row so retries/follow-ups
//                                      don't duplicate.
//   4. no match                     → create a new meeting flagged needs_review
//                                      (the user can later merge it onto the real
//                                      meeting via the generic merge).
//
// Matching gates on START, never on END — meetings run short/long, so end time is
// the unreliable signal. Synchronous, deterministic, no LLM.
//
// Idempotent: each event's content is wrapped in a hidden marker
// (`<!-- krisp:note -->`) so a re-delivery (or the same event resent) is a no-op,
// and the 2–3 events for one meeting accumulate into one body.

import { slugify } from '../_shared/_slug.js';
import { logger as rootLogger } from '../../lib/logger.js';

const logger = rootLogger.child({ component: 'krisp-webhook' });

interface MeetingsServiceLike {
  findByKrispMeetingId(userId: number, krispMeetingId: string): Promise<any>;
  findTimeMatchCandidates(userId: number, startsAtIso: string, windowMs: number): Promise<any[]>;
  getById(userId: number, id: number): Promise<any>;
  create(userId: number, accountId: number | null, data: unknown): Promise<any>;
  update(userId: number, id: number, data: unknown): Promise<any>;
}

// Normalized view of one Krisp delivery.
interface ParsedKrisp {
  eventType: string; // canonical: note | transcript | outline
  krispMeetingId: string | null;
  title: string | null;
  startsAt: string | null; // ISO instant
  endsAt: string | null;
  content: string; // markdown body fragment for this event
}

interface IngestResult {
  ok: true;
  event: string;
  krisp_meeting_id: string | null;
  outcome: 'created' | 'matched' | 'updated' | 'noop';
  meeting_id: number | null;
  needs_review: boolean;
  review_reason: string | null;
  note?: string;
}

const DEFAULT_WINDOW_MIN = 10;
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
// philosophy: an unrecognized label collapses to "note" so the import never
// breaks on a new trigger name.
function canonicalEvent(raw: string | null): string {
  const v = (raw || '').toLowerCase();
  if (v.includes('transcript')) return 'transcript';
  if (v.includes('outline')) return 'outline';
  return 'note';
}

// Krisp pre-renders clean markdown in data.raw_content — prefer it verbatim. Fall
// back to a JSON dump of the data block so nothing is lost if the field is ever
// absent (and so the real shape surfaces in the CRM for us to refine against).
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
    content: buildContent(data),
  };
}

// Temporal overlap of [aStart,aEnd] and [bStart,bEnd] in ms (0 if either end is
// unknown or they don't overlap).
function overlapMs(aStart: number, aEnd: number | null, bStart: number, bEnd: number | null): number {
  if (aEnd == null || bEnd == null) return 0;
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

// Choose the single best time-match among in-window candidates, or null if none
// is confident. Gate is on START (already applied by the SQL range); among
// several, the largest time-overlap wins, with start-proximity as the tiebreak.
// If the top two are effectively tied (equal overlap and starts within a minute
// of each other), it's ambiguous → null (park, don't guess).
export function pickMatch(candidates: any[], krispStartMs: number, krispEndMs: number | null): any | null {
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];
  const scored = candidates.map((c) => {
    const cs = new Date(c.starts_at).getTime();
    const ce = c.ends_at ? new Date(c.ends_at).getTime() : null;
    return { c, overlap: overlapMs(krispStartMs, krispEndMs, cs, ce), prox: Math.abs(cs - krispStartMs) };
  });
  scored.sort((a, b) => (b.overlap - a.overlap) || (a.prox - b.prox));
  const [top, second] = scored;
  if (top.overlap === second.overlap && Math.abs(top.prox - second.prox) < 60_000) return null;
  return top.c;
}

export class KrispWebhookService {
  meetings: MeetingsServiceLike;
  windowMs: number;

  constructor({ meetingsService }: { meetingsService?: MeetingsServiceLike } = {}) {
    if (!meetingsService) throw new Error('KrispWebhookService requires meetingsService');
    this.meetings = meetingsService;
    const min = Number(process.env.KRISP_MATCH_WINDOW_MIN) || DEFAULT_WINDOW_MIN;
    this.windowMs = min * 60_000;
  }

  async ingest(userId: number, raw: unknown): Promise<IngestResult> {
    const p = parseKrisp(raw);
    const fragment = `<!-- krisp:${p.eventType} -->\n${p.content.trim()}\n`;

    let parkedReviewReason = 'krisp_no_match';

    // 1. Time-proximity match against an existing (e.g. calendar-imported) meeting.
    // A Krisp id cannot exist on that row until this webhook has already landed
    // once, so time is the primary association signal.
    if (p.startsAt) {
      const candidates = await this.meetings.findTimeMatchCandidates(userId, p.startsAt, this.windowMs);
      if (candidates.length === 1) {
        const full = await this.meetings.getById(userId, candidates[0].id);
        if (full) {
          const linkKrispId = full.krisp_meeting_id ? null : p.krispMeetingId;
          return this._append(userId, full, p, fragment, { linkKrispId });
        }
      } else if (candidates.length > 1) {
        parkedReviewReason = 'krisp_multiple_matches';
        const match = pickMatch(candidates, new Date(p.startsAt).getTime(), p.endsAt ? new Date(p.endsAt).getTime() : null);
        if (!match) {
          logger.warn({ event: 'krisp_webhook.ambiguous_time_match', krispEvent: p.eventType, candidateIds: candidates.map((c) => c.id) }, 'krisp time match ambiguous — parking for review');
        } else {
          const full = await this.meetings.getById(userId, match.id);
          if (full) {
            const linkKrispId = full.krisp_meeting_id ? null : p.krispMeetingId;
            return this._append(userId, full, p, fragment, { linkKrispId, reviewReason: 'krisp_multiple_matches' });
          }
        }
      }
    }

    // 2. Fallback only: if a previous Krisp delivery already created/linked a row
    // and this delivery has no usable/unique time match, fold into that row. This
    // is not how the first delivery finds the calendar-created meeting.
    if (p.krispMeetingId) {
      const existing = await this.meetings.findByKrispMeetingId(userId, p.krispMeetingId);
      if (existing) {
        const reviewReason = parkedReviewReason === 'krisp_multiple_matches' ? parkedReviewReason : null;
        return this._append(userId, existing, p, fragment, { reviewReason });
      }
    }

    // 3. No confident match → park a new meeting for review (mergeable later).
    return this._createParked(userId, p, fragment, parkedReviewReason);
  }

  // Append this event's marker-wrapped content onto an existing meeting.
  // Marker-guarded: a re-delivered event is a no-op. Backfills start/end when
  // missing. A clean single time-match stays settled; only ambiguous/multiple
  // matches set a review reason. `linkKrispId` is set only when a fresh
  // time-match needs to remember the Krisp id for retry/follow-up fallback.
  async _append(
    userId: number,
    existing: any,
    p: ParsedKrisp,
    fragment: string,
    { linkKrispId = null, reviewReason = null }: { linkKrispId?: string | null; reviewReason?: string | null } = {},
  ): Promise<IngestResult> {
    const marker = `<!-- krisp:${p.eventType} -->`;
    const body = existing.body || '';
    if (body.includes(marker)) {
      logger.info({ event: 'krisp_webhook.noop', meeting_id: existing.id, krispEvent: p.eventType }, 'krisp event already imported — no-op');
      return { ok: true, event: p.eventType, krisp_meeting_id: p.krispMeetingId, outcome: 'noop', meeting_id: existing.id, needs_review: !!existing.needs_review, review_reason: existing.review_reason || null, note: 'This event was already imported — left as-is.' };
    }
    const needsReview = !!reviewReason || !!existing.needs_review;
    const data: Record<string, unknown> = {
      body: `${body.trimEnd()}\n\n${fragment}`.trim(),
      needs_review: needsReview,
      review_reason: needsReview ? (reviewReason || existing.review_reason || 'manual') : null,
    };
    if (linkKrispId && !existing.krisp_meeting_id) data.krisp_meeting_id = linkKrispId;
    if (!existing.starts_at && p.startsAt) data.starts_at = p.startsAt;
    if (!existing.ends_at && p.endsAt) data.ends_at = p.endsAt;
    await this.meetings.update(userId, existing.id, data);
    const outcome = linkKrispId ? 'matched' : 'updated';
    logger.info({ event: 'krisp_webhook.appended', meeting_id: existing.id, krispEvent: p.eventType, outcome }, `krisp ${p.eventType} appended to meeting ${existing.id}`);
    return { ok: true, event: p.eventType, krisp_meeting_id: p.krispMeetingId, outcome, meeting_id: existing.id, needs_review: needsReview, review_reason: data.review_reason as string | null };
  }

  async _createParked(userId: number, p: ParsedKrisp, fragment: string, reviewReason = 'krisp_no_match'): Promise<IngestResult> {
    const date = (p.startsAt ? p.startsAt.slice(0, 10) : new Date().toISOString().slice(0, 10));
    const key = p.krispMeetingId || slugify(`${date}-${p.title || 'krisp'}`) || `note-${date}`;
    const row = await this.meetings.create(userId, null, {
      date,
      starts_at: p.startsAt,
      ends_at: p.endsAt,
      title: p.title,
      filename: `krisp-${key}`,
      body: fragment.trim() || '_Krisp note — no content provided._',
      internal: true,
      needs_review: true,
      review_reason: reviewReason,
      krisp_meeting_id: p.krispMeetingId || null,
    });
    logger.info({ event: 'krisp_webhook.parked', meeting_id: row.id, krispEvent: p.eventType }, `krisp ${p.eventType} parked as new meeting ${row.id}`);
    return { ok: true, event: p.eventType, krisp_meeting_id: p.krispMeetingId, outcome: 'created', meeting_id: row.id, needs_review: true, review_reason: reviewReason };
  }
}
