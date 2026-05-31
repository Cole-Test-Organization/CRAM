// Notes-import pipeline. A user drops in a directory of markdown/text notes
// (from Obsidian, Apple/Google Notes, a folder of call summaries, …). We can't
// feed the whole directory to the local model — it has a small context window —
// so the model only ever sees ONE file at a time and returns structured
// metadata for it. Deterministic code then resolves each note to an account and
// writes it through the meetings service:
//
//   per file:  extract (local LLM, one-shot, no tools)
//           →  resolve account via accounts.findOrCreate
//           →  write via meetings.create (linked, auto-created, or parked)
//
// Account resolution honours the "separate creation from assignment" model the
// import-triage refactor built (see migration 1000000000033):
//   - confident match (exact, or fuzzy >= autolink)  → link, clean.
//   - nothing similar ('none' + createIfMissing)      → auto-create the account
//                                                        (flagged needs_review)
//                                                        and link the note.
//   - ambiguous (a fuzzy 0.4–0.85 match exists)        → DON'T mint a near-dup;
//                                                        park the note
//                                                        (internal + needs_review)
//                                                        so the user assigns it
//                                                        to the right existing
//                                                        account via triage.
//   - internal / no account hint                       → park (internal +
//                                                        needs_review).
//
// Re-import is idempotent: the meeting filename is derived from the source file
// PATH (stable across runs), and meetings has unique indexes on
// (account_id, filename) and (user_id, filename WHERE account_id IS NULL), so a
// repeat of the same file trips a 23505 we catch and report as "skipped".
//
// Jobs run serially behind a single worker — like contact-enrichment, we never
// fire two local-LLM calls at once (one small box, limited VRAM).

import crypto from 'crypto';
import AdmZip from 'adm-zip';
import * as localProvider from '../agent/providers/local.js';
import { deriveFilename } from './_slug.js';
import { logger as rootLogger } from '../lib/logger.js';

const logger = rootLogger.child({ component: 'notes-import' });

const MAX_JOBS_IN_MEMORY = Number(process.env.NOTES_IMPORT_MAX_JOBS) || 50;
const MAX_FILES_PER_JOB = Number(process.env.NOTES_IMPORT_MAX_FILES) || 2000;
// How much of a file we hand the model for metadata extraction. The full text
// is still stored as the meeting body — this only bounds the prompt so a giant
// note can't blow the small local context window.
const MAX_EXTRACT_CHARS = Number(process.env.NOTES_IMPORT_MAX_EXTRACT_CHARS) || 16000;
// Largest single file we'll pull out of a zip (defends against zip bombs / stray
// binaries). Text notes are tiny; 2MB is already generous.
const MAX_ZIP_ENTRY_BYTES = Number(process.env.NOTES_IMPORT_MAX_ZIP_ENTRY_BYTES) || 2 * 1024 * 1024;

const LLM_TIMEOUT_MS = Number(process.env.NOTES_IMPORT_LLM_TIMEOUT_MS) || 120000;
const LLM_MAX_ATTEMPTS = Number(process.env.NOTES_IMPORT_LLM_RETRIES) || 3;
const LLM_RETRY_BASE_MS = Number(process.env.NOTES_IMPORT_LLM_RETRY_BASE_MS) || 4000;
const LLM_RETRY_MAX_MS = 30000;

// Text-ish extensions we'll pull out of an uploaded archive. Everything else in
// the zip (images, PDFs, .DS_Store, …) is ignored.
const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.txt', '.text', '.org', '.rst']);

const EXTRACT_SYSTEM_PROMPT = `You are a data extractor for a CRM's notes importer. You receive ONE note file — its filename and full text — and return a single JSON object of metadata. Return ONLY the JSON: no prose, no commentary, no markdown code fences.

Output schema:
{
  "date": "YYYY-MM-DD" | null,      // The note's date. Look in the text first, then the filename (notes are often named like "2026-02-14" or "2026-02-14-acme-sync"). null if you truly cannot find one.
  "title": string | null,            // A short human title (e.g. "Prisma Access demo", "Q2 review"). Derive from a heading or the filename. null if unclear.
  "account_name": string | null,     // The EXTERNAL company the note is about (the customer/prospect). null if the note is internal-only or no company is identifiable.
  "account_domain": string | null,   // A domain for that company if one appears verbatim (e.g. "acme.com"). null otherwise.
  "is_internal": boolean,            // true if this is an internal note (your own team only, no external customer). false if it concerns an external company.
  "attendees": [                      // People named as attending/participating. [] if none.
    { "name": string, "email": string | null }
  ]
}

Rules:
- Use null (never a guess) for anything you cannot determine from the input.
- account_name is the CUSTOMER company being sold to — never the note-taker's own employer. If the note is purely internal, set account_name=null and is_internal=true.
- Do NOT invent emails or domains; include them only if they appear verbatim in the text.
- Output exactly one JSON object — no surrounding text, no code fences.`;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function normalizeDomain(d) {
  if (!d || typeof d !== 'string') return null;
  return d.trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '') || null;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Strip ```json fences / leading prose, parse the first {...} block. Mirrors the
// contact-enrichment formatter's tolerance for chatty small models.
export function parseLooseJson(text) {
  if (typeof text !== 'string') return null;
  let t = text.trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) t = fence[1].trim();
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  try { return JSON.parse(t.slice(first, last + 1)); } catch { return null; }
}

// Coerce a raw parsed object into the normalized extraction record we act on.
// Defensive: a small model returns all sorts of shapes. Never throws.
export function normalizeExtraction(obj) {
  const rec = {
    date: null,
    title: null,
    account_name: null,
    account_domain: null,
    is_internal: false,
    attendees: [],
  };
  if (!obj || typeof obj !== 'object') return rec;

  if (typeof obj.date === 'string' && DATE_RE.test(obj.date.trim())) rec.date = obj.date.trim();
  if (typeof obj.title === 'string' && obj.title.trim() && obj.title.trim().toLowerCase() !== 'null') rec.title = obj.title.trim();
  if (typeof obj.account_name === 'string' && obj.account_name.trim() && obj.account_name.trim().toLowerCase() !== 'null') rec.account_name = obj.account_name.trim();
  rec.account_domain = normalizeDomain(obj.account_domain);
  rec.is_internal = obj.is_internal === true || String(obj.is_internal).toLowerCase() === 'true';

  const seen = new Set();
  if (Array.isArray(obj.attendees)) {
    for (const a of obj.attendees) {
      const name = typeof a === 'string' ? a : (a?.name || a?.display_name || '');
      const clean = String(name || '').trim();
      if (!clean || clean.toLowerCase() === 'null') continue;
      const key = clean.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const email = a && typeof a === 'object' && typeof a.email === 'string' && a.email.includes('@')
        ? a.email.trim().toLowerCase()
        : null;
      rec.attendees.push({ display_name: clean, email });
    }
  }
  return rec;
}

// Turn an uploaded zip buffer into the canonical files[] list. Only text-ish
// entries are kept; directories, oversized entries, and binaries are skipped.
export function filesFromZip(buffer) {
  const zip = new AdmZip(buffer);
  const out = [];
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const path = entry.entryName;
    // Skip macOS/junk metadata and dotfiles.
    if (/(^|\/)(__MACOSX\/|\.DS_Store$|\._)/.test(path)) continue;
    const dot = path.lastIndexOf('.');
    const ext = dot === -1 ? '' : path.slice(dot).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) continue;
    if (entry.header.size > MAX_ZIP_ENTRY_BYTES) continue;
    const content = entry.getData().toString('utf8');
    out.push({ path, content });
  }
  return out;
}

export class NotesImportService {
  // `extractor` is an optional override (file, { baseUrl, model }) => record,
  // used by tests to exercise resolution/write without a live model.
  constructor({ meetingsService, accountsService, agentSettingsService, extractor } = {}) {
    if (!meetingsService) throw new Error('NotesImportService requires meetingsService');
    if (!accountsService) throw new Error('NotesImportService requires accountsService');
    this.meetingsService = meetingsService;
    this.accountsService = accountsService;
    this.agentSettingsService = agentSettingsService || null;
    this.extractor = extractor || null;
    this.jobs = new Map();
    this.queue = [];
    this.running = false;
  }

  // Validate + stage a list of files, return a jobId immediately. Background
  // work is detached; the caller polls getJob.
  enqueue(userId, { files } = {}) {
    if (!Array.isArray(files) || files.length === 0) {
      throw Object.assign(new Error('files must be a non-empty array of { path, content }. Read the notes directory client-side (or upload a .zip to the upload endpoint).'), { statusCode: 400 });
    }
    const cleaned = [];
    for (const f of files) {
      const path = typeof f?.path === 'string' ? f.path.trim() : '';
      const content = typeof f?.content === 'string' ? f.content : '';
      if (!path || !content.trim()) continue; // skip empties / malformed
      cleaned.push({ path, content });
      if (cleaned.length >= MAX_FILES_PER_JOB) break;
    }
    if (cleaned.length === 0) {
      throw Object.assign(new Error('No non-empty text files found in the input.'), { statusCode: 400 });
    }

    const jobId = crypto.randomUUID();
    const job = {
      jobId,
      userId,
      status: 'queued',
      stage: null,
      total: cleaned.length,
      processed: 0,
      counts: { linked: 0, created: 0, parked: 0, skipped: 0, error: 0 },
      results: [],
      error: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
    };
    // Source files held off the public job view (getJob) to keep poll responses
    // small and avoid echoing note contents back on every poll.
    Object.defineProperty(job, '_files', { value: cleaned, enumerable: false });
    this.jobs.set(jobId, job);
    this._evictOldJobs();
    this.queue.push(jobId);
    this._drain().catch((err) => {
      logger.error({ event: 'notes_import.worker_crashed', err: err.message, stack: err.stack }, 'notes-import worker crashed');
      this.running = false;
    });
    return jobId;
  }

  getJob(jobId) {
    const j = this.jobs.get(jobId);
    if (!j) return null;
    // _files is non-enumerable, so the spread drops it.
    return { ...j };
  }

  listJobs({ status, limit = 50 } = {}) {
    let jobs = [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (status) jobs = jobs.filter((j) => j.status === status);
    return jobs.slice(0, limit).map((j) => ({ ...j }));
  }

  async _drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const jobId = this.queue.shift();
        if (!this.jobs.has(jobId)) continue;
        try {
          await this._run(jobId);
        } catch (err) {
          logger.error({ event: 'notes_import.run_crashed', err: err.message, stack: err.stack, jobId }, 'notes-import run crashed');
          const j = this.jobs.get(jobId);
          if (j && j.status !== 'completed' && j.status !== 'failed') {
            j.status = 'failed';
            j.error = err.message || String(err);
            j.completedAt = new Date().toISOString();
          }
        }
      }
    } finally {
      this.running = false;
    }
  }

  async _run(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.status = 'running';
    job.startedAt = new Date().toISOString();

    // Resolve the user's local-LLM settings once for the whole job.
    let settings = null;
    if (this.agentSettingsService) {
      try {
        settings = await this.agentSettingsService.getEffective(job.userId);
      } catch (err) {
        logger.warn({ event: 'notes_import.settings_lookup_failed', err: err.message }, 'failed to resolve agent settings — falling back to env');
      }
    }
    const baseUrl = settings?.local_base_url || process.env.LOCAL_BASE_URL || null;
    const model = settings?.model || process.env.LOCAL_MODEL || 'local';

    for (const file of job._files) {
      job.stage = `extracting ${job.processed + 1}/${job.total}`;
      let result;
      try {
        const extracted = await this._extract(file, { baseUrl, model });
        result = await this._writeOne(job.userId, file, extracted);
      } catch (err) {
        result = { path: file.path, ok: false, outcome: 'error', error: err.message || String(err) };
      }
      job.results.push(result);
      job.counts[result.outcome] = (job.counts[result.outcome] || 0) + 1;
      job.processed++;
    }

    job.status = 'completed';
    job.stage = 'done';
    job.completedAt = new Date().toISOString();
    logger.info({ event: 'notes_import.completed', jobId, ...job.counts, total: job.total }, 'notes-import completed');
  }

  // Extract metadata for one file. Uses the injected test extractor if present,
  // otherwise the local LLM (one-shot, no tools, with a JSON reprompt).
  async _extract(file, { baseUrl, model }) {
    if (this.extractor) {
      return normalizeExtraction(await this.extractor(file, { baseUrl, model }));
    }
    if (!baseUrl) {
      throw new Error('No local LLM URL configured — set it in Settings → Agent LLM (or LOCAL_BASE_URL env var).');
    }
    const content = file.content.length > MAX_EXTRACT_CHARS
      ? file.content.slice(0, MAX_EXTRACT_CHARS)
      : file.content;
    const userPrompt = `Filename: ${file.path}

Note content (may be truncated):
${content}

Return ONLY the JSON object specified in the system prompt.`;

    const messages = [{ role: 'user', content: userPrompt }];
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = await this._callLLM({ system: EXTRACT_SYSTEM_PROMPT, messages, model, baseUrl });
      const parsed = parseLooseJson(text);
      if (parsed) return normalizeExtraction(parsed);
      // Content (not transport) failure — model answered but JSON was unusable.
      // Reprompt once; the server is clearly healthy so no backoff.
      messages.push({ role: 'assistant', content: [{ type: 'text', text }] });
      messages.push({ role: 'user', content: [{ type: 'text', text: 'That was not valid JSON. Return ONLY the JSON object from the system prompt — no prose, no code fences. Use null for unknown fields.' }] });
    }
    // Both attempts unparseable: fall back to an empty record so the file still
    // imports (it'll park as internal/needs_review with the body intact) rather
    // than failing the whole file.
    return normalizeExtraction(null);
  }

  // Local LLM call with timeout + retry-with-backoff on transport failures.
  // Lifted from contact-enrichment — same resilience needs against a flaky LAN
  // inference box.
  async _callLLM({ system, messages, model, baseUrl }) {
    let lastErr = null;
    for (let attempt = 1; attempt <= LLM_MAX_ATTEMPTS; attempt++) {
      try {
        const { content } = await localProvider.streamTurn({
          model, system, messages, mcpTools: [],
          providerConfig: { baseUrl }, timeoutMs: LLM_TIMEOUT_MS,
        });
        const text = (content || []).filter((b) => b?.type === 'text').map((b) => b.text).join('').trim();
        if (!text) throw new Error('local LLM returned an empty response');
        return text;
      } catch (err) {
        lastErr = err;
        if (attempt < LLM_MAX_ATTEMPTS) {
          const waitMs = Math.min(LLM_RETRY_BASE_MS * 2 ** (attempt - 1), LLM_RETRY_MAX_MS);
          logger.warn({ event: 'notes_import.llm_retry', attempt, maxAttempts: LLM_MAX_ATTEMPTS, waitMs, err: err.message }, 'local LLM call failed — retrying');
          await sleep(waitMs);
        }
      }
    }
    throw new Error(`local LLM call failed after ${LLM_MAX_ATTEMPTS} attempts: ${lastErr?.message || String(lastErr)}`);
  }

  // Resolve one extracted record to an account and write the meeting. Returns a
  // per-file result the job report surfaces. Idempotent: a duplicate filename
  // (re-import of the same source file) is caught and reported as "skipped".
  async _writeOne(userId, file, ex) {
    // Stable, path-derived filename → re-importing the same file collides on the
    // meetings unique index instead of creating a second copy.
    const filename = deriveFilename(ex.date || todayIso(), null, stripExt(file.path));
    const date = ex.date || todayIso();
    const title = ex.title || null;
    const body = file.content;
    const unlinked = ex.attendees;

    // Decide account assignment.
    const hasHint = !ex.is_internal && (ex.account_name || ex.account_domain);
    let decision;
    if (!hasHint) {
      decision = { kind: 'parked', reason: ex.is_internal ? 'internal' : 'no_account_hint' };
    } else {
      const res = await this.accountsService.findOrCreate(
        userId,
        { name: ex.account_name || undefined, domains: ex.account_domain ? [ex.account_domain] : [] },
        { createIfMissing: true, fuzzy: true },
      );
      if (res.status === 'matched') {
        decision = { kind: 'linked', account: res.account, matched_by: res.matched_by, match_score: res.match_score };
      } else if (res.status === 'created') {
        decision = { kind: 'created', account: res.account };
      } else {
        // 'ambiguous' — a fuzzy 0.4–0.85 match exists. Don't mint a near-dup;
        // park with the candidate shortlist so triage can place it.
        decision = { kind: 'parked', reason: 'ambiguous', candidates: res.candidates || [] };
      }
    }

    const linked = decision.kind === 'linked' || decision.kind === 'created';
    try {
      const meeting = await this.meetingsService.create(
        userId,
        linked ? decision.account.id : null,
        {
          date,
          title,
          filename,
          body,
          internal: !linked,
          needs_review: !linked, // parked notes go in the meetings review queue; linked ones are clean (auto-created accounts carry their own flag)
          unlinked_attendees: unlinked,
        },
      );
      return {
        path: file.path,
        ok: true,
        outcome: decision.kind === 'created' ? 'created' : (linked ? 'linked' : 'parked'),
        reason: decision.reason || null,
        meeting_id: meeting.id,
        account_id: linked ? decision.account.id : null,
        account_slug: linked ? decision.account.slug : null,
        account_created: decision.kind === 'created',
        matched_by: decision.matched_by || null,
        match_score: decision.match_score ?? null,
        candidates: decision.candidates || null,
      };
    } catch (err) {
      if (err.code === '23505') {
        return { path: file.path, ok: true, outcome: 'skipped', reason: 'duplicate', note: 'A meeting from this file already exists (matched on filename) — left as-is.' };
      }
      throw err;
    }
  }

  _evictOldJobs() {
    if (this.jobs.size <= MAX_JOBS_IN_MEMORY) return;
    const finished = [...this.jobs.values()]
      .filter((j) => j.status === 'completed' || j.status === 'failed')
      .sort((a, b) => (a.completedAt || '').localeCompare(b.completedAt || ''));
    const toRemove = this.jobs.size - MAX_JOBS_IN_MEMORY;
    for (let i = 0; i < toRemove && i < finished.length; i++) {
      this.jobs.delete(finished[i].jobId);
    }
  }
}

// "acme/2026-02-14-sync.md" → "acme/2026-02-14-sync" (deriveFilename then
// slugifies the whole stem, collapsing the slash, so the result is stable and
// unique per source path).
function stripExt(path) {
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  return dot > slash ? path.slice(0, dot) : path;
}
