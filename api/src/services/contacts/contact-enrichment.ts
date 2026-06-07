// Post-meeting contact enrichment pipeline.
//
// For each contact flagged by the from-emails meeting flow, this service:
//   1. Enqueues a `person` research job through OutreachService (LinkedIn +
//      web — same queue, same rate limits as the rest of the app).
//   2. Polls the outreach job until it completes.
//   3. Hands the raw research blob to the locally configured LLM with NO
//      tools available and a JSON-schema-shaped prompt.
//   4. Verifies the LLM's output is valid JSON with the expected fields,
//      retries once if not, then drops the run if the second attempt still
//      doesn't parse — better to leave the contact untouched than to write
//      garbage.
//   5. PATCHes the contact with the validated fields.
//
// Jobs run serially behind the outreach queue (outreach already serializes
// LinkedIn calls). The local LLM call is one-shot per job — we don't run
// multiple formatter calls in parallel either, to keep the local box from
// getting hammered.

import crypto from 'crypto';
import * as localProvider from '../../agent/providers/local.js';
import { logger as rootLogger } from '../../lib/logger.js';
import { sleep, parseLooseJson } from '../_shared/_llm.js';

const logger = rootLogger.child({ component: 'contact-enrichment' });

// Cap on how long we'll wait for an outreach job to finish before giving up.
// Outreach jobs typically take 30–60s; the rate-limit min-gap is 10s so a
// backed-up queue could keep us waiting. 10 minutes is more than enough for
// a single job to clear the queue.
const MAX_OUTREACH_WAIT_MS = 10 * 60 * 1000;
const OUTREACH_POLL_MS = 2000;
const MAX_JOBS_IN_MEMORY = 200;

// Local LLM call resilience. The formatter hits a single local model that can
// be slow, or briefly unresponsive while it loads/swaps weights. Rather than
// fail the whole enrichment on the first hiccup, bound each call with a timeout
// and retry a few times with exponential backoff. All tunable via env.
const LLM_TIMEOUT_MS = Number(process.env.CONTACT_ENRICHMENT_LLM_TIMEOUT_MS) || 120000;
const LLM_MAX_ATTEMPTS = Number(process.env.CONTACT_ENRICHMENT_LLM_RETRIES) || 3;
const LLM_RETRY_BASE_MS = Number(process.env.CONTACT_ENRICHMENT_LLM_RETRY_BASE_MS) || 5000;
const LLM_RETRY_MAX_MS = 30000;

const STRING_FIELDS = ['title', 'linkedin', 'location_raw', 'city', 'state', 'country', 'notes'];

interface ContactEnrichmentJob {
  jobId: string;
  userId: number;
  contactId: number;
  name: string;
  accountName: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed';
  stage: string | null;
  outreachJobId: string | null;
  error: string | null;
  patched: Record<string, string> | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

// Injected dependencies arrive via a `services` bag (see api/src/mcp/server.js
// and api/src/agent/mcp-client.js); typed loosely here so this service stays
// decoupled from each collaborator's concrete class.
interface ContactEnrichmentDeps {
  outreachService?: any;
  contactsService?: any;
  agentSettingsService?: any;
  getDefaultUserId?: (() => number) | null;
}

// Canonical message shape handed to the local provider. `content` is a plain
// string on the first turn and a text-block array on reprompts.
type LlmMessage = { role: string; content: string | Array<{ type: string; text: string }> };

const FORMAT_SYSTEM_PROMPT = `You are a data extractor for a CRM. You receive a raw research blob about a single person (JSON from a LinkedIn + web lookup) and must return a structured JSON object with whatever you can confidently extract.

Output schema (return ONLY this JSON object — no prose, no markdown, no code fences):

{
  "title": string | null,         // Current job title, e.g. "VP of Engineering"
  "linkedin": string | null,       // Full LinkedIn profile URL (must contain "linkedin.com")
  "location_raw": string | null,   // Verbatim location string from the source
  "city": string | null,           // Normalized city, e.g. "Phoenix"
  "state": string | null,          // Normalized state/region, e.g. "AZ"
  "country": string | null,        // Normalized country, e.g. "USA"
  "notes": string | null           // 2–3 sentence background summary tailored for a sales engineer prepping for a call (current role, prior companies, notable signals). Plain prose, no bullets.
}

Rules:
- Use null for any field you cannot determine from the input. Do NOT guess.
- Do NOT invent a LinkedIn URL — only include it if it appears verbatim in the input.
- Keep notes concise. No marketing fluff; sales engineers want signal.
- Output exactly one JSON object. No extra keys, no surrounding text, no \`\`\` fences.`;

export class ContactEnrichmentService {
  outreachService: any;
  contactsService: any;
  agentSettingsService: any;
  getDefaultUserId: (() => number) | null | undefined;
  jobs: Map<string, ContactEnrichmentJob>;
  queue: string[];
  running: boolean;

  constructor({ outreachService, contactsService, agentSettingsService, getDefaultUserId }: ContactEnrichmentDeps = {}) {
    if (!outreachService) throw new Error('ContactEnrichmentService requires outreachService');
    if (!contactsService) throw new Error('ContactEnrichmentService requires contactsService');
    this.outreachService = outreachService;
    this.contactsService = contactsService;
    this.agentSettingsService = agentSettingsService || null;
    this.getDefaultUserId = getDefaultUserId; // optional fallback
    this.jobs = new Map();
    // Serial worker state. Enrichment pipelines run strictly one at a time so
    // we never fire two local-LLM formatter calls concurrently (limited VRAM).
    this.queue = [];
    this.running = false;
  }

  // Returns the enrichment job id immediately. Background work is detached —
  // the caller (e.g., the meeting POST handler) responds without waiting for
  // outreach + LLM to finish.
  enqueue(userId: number, { contactId, name, accountName }: { contactId: number; name: string; accountName?: string | null }) {
    if (!contactId) throw new Error('enqueue requires contactId');
    if (!name) throw new Error('enqueue requires name');
    const jobId = crypto.randomUUID();
    const job: ContactEnrichmentJob = {
      jobId,
      userId,
      contactId,
      name,
      accountName: accountName || null,
      status: 'queued',
      stage: null,
      outreachJobId: null,
      error: null,
      patched: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
    };
    this.jobs.set(jobId, job);
    this._evictOldJobs();
    // Serialize: enqueue and let the single worker drain it. Two enrichment
    // pipelines in flight would mean two concurrent LLM formatter calls, which
    // the local box can't afford — so they must run one at a time.
    this.queue.push(jobId);
    this._drain().catch((err) => {
      logger.error({ event: 'enrichment.worker_crashed', err: err.message, stack: err.stack }, 'enrichment worker crashed');
      this.running = false;
    });
    return jobId;
  }

  getJob(jobId: string) {
    return this.jobs.get(jobId) || null;
  }

  listJobs({ status, limit = 50 }: { status?: string; limit?: number } = {}) {
    let jobs = [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (status) jobs = jobs.filter((j) => j.status === status);
    return jobs.slice(0, limit);
  }

  // Return all jobs (any status) for a set of contact IDs. The meeting view
  // uses this to surface a progress panel for the attendees the user opted
  // into research for. Newest first.
  listJobsForContacts(contactIds: Array<number | string>) {
    if (!Array.isArray(contactIds) || contactIds.length === 0) return [];
    const set = new Set(contactIds.map((id) => Number(id)));
    return [...this.jobs.values()]
      .filter((j) => set.has(Number(j.contactId)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // Single-worker queue drain. Guarantees enrichment jobs — and therefore the
  // local LLM formatter calls inside them — run strictly one at a time, even
  // when a meeting flow enqueues several attendees back-to-back.
  async _drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const jobId = this.queue.shift()!;
        if (!this.jobs.has(jobId)) continue;
        try {
          await this._run(jobId);
        } catch (err) {
          logger.error({ event: 'enrichment.run_crashed', err: (err as Error).message, stack: (err as Error).stack, jobId }, 'enrichment run crashed');
          const j = this.jobs.get(jobId);
          if (j && j.status !== 'completed' && j.status !== 'failed') {
            j.status = 'failed';
            j.error = (err as Error).message || String(err);
            j.completedAt = new Date().toISOString();
          }
        }
      }
    } finally {
      this.running = false;
    }
  }

  async _run(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.status = 'running';
    job.startedAt = new Date().toISOString();

    // 1) enqueue outreach
    job.stage = 'researching';
    let outreachJob;
    try {
      outreachJob = this.outreachService.enqueue({
        type: 'person',
        name: job.name,
        company: job.accountName || undefined,
        linkedin: true,
        deep: true,
      });
    } catch (err) {
      job.status = 'failed';
      job.error = `outreach enqueue failed: ${(err as Error).message || String(err)}`;
      job.completedAt = new Date().toISOString();
      return;
    }
    job.outreachJobId = outreachJob.jobId;

    // 2) poll outreach until done
    const deadline = Date.now() + MAX_OUTREACH_WAIT_MS;
    let result = null;
    while (true) {
      if (Date.now() > deadline) {
        job.status = 'failed';
        job.error = `outreach job ${outreachJob.jobId} did not finish within ${MAX_OUTREACH_WAIT_MS}ms`;
        job.completedAt = new Date().toISOString();
        return;
      }
      await sleep(OUTREACH_POLL_MS);
      const o = this.outreachService.getJob(outreachJob.jobId);
      if (!o) continue;
      if (o.status === 'completed') { result = o.result; break; }
      if (o.status === 'failed') {
        job.status = 'failed';
        job.error = `outreach job failed: ${o.error || 'unknown'}`;
        job.completedAt = new Date().toISOString();
        return;
      }
    }

    // 3) format with local LLM (no tools). Resolve the user's saved
    //    agent settings here so we hit *their* configured local server,
    //    not whatever happens to be in the container's env.
    job.stage = 'formatting';
    let resolvedSettings = null;
    if (this.agentSettingsService) {
      try {
        resolvedSettings = await this.agentSettingsService.getEffective(job.userId);
      } catch (err) {
        logger.warn({ event: 'enrichment.settings_lookup_failed', err: (err as Error).message }, 'failed to resolve agent settings — falling back to env');
      }
    }
    let patch;
    try {
      patch = await formatWithLocalLLM({
        name: job.name,
        accountName: job.accountName,
        research: result,
        baseUrl: resolvedSettings?.local_base_url || null,
        model: resolvedSettings?.model || null,
      });
    } catch (err) {
      job.status = 'failed';
      job.error = `formatter error: ${(err as Error).message || String(err)}`;
      job.completedAt = new Date().toISOString();
      return;
    }
    if (!patch || Object.keys(patch).length === 0) {
      job.status = 'failed';
      job.error = 'formatter returned no usable fields after retry';
      job.completedAt = new Date().toISOString();
      return;
    }

    // 4) patch the contact
    job.stage = 'patching';
    try {
      await this.contactsService.patch(job.userId, job.contactId, patch);
    } catch (err) {
      job.status = 'failed';
      job.error = `contact patch failed: ${(err as Error).message || String(err)}`;
      job.completedAt = new Date().toISOString();
      return;
    }

    job.status = 'completed';
    job.stage = 'done';
    job.patched = patch;
    job.completedAt = new Date().toISOString();
  }

  _evictOldJobs() {
    if (this.jobs.size <= MAX_JOBS_IN_MEMORY) return;
    const sorted = [...this.jobs.values()]
      .filter((j) => j.status === 'completed' || j.status === 'failed')
      .sort((a, b) => (a.completedAt || '').localeCompare(b.completedAt || ''));
    const toRemove = this.jobs.size - MAX_JOBS_IN_MEMORY;
    for (let i = 0; i < toRemove && i < sorted.length; i++) {
      this.jobs.delete(sorted[i].jobId);
    }
  }
}

// Keep only the fields we expect, drop empties, sanity-check linkedin url.
function validateAndClean(obj: any): Record<string, string> | null {
  if (!obj || typeof obj !== 'object') return null;
  const out: Record<string, string> = {};
  for (const f of STRING_FIELDS) {
    const v = obj[f];
    if (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null') {
      out[f] = v.trim();
    }
  }
  if (out.linkedin && !/linkedin\.com/i.test(out.linkedin)) {
    delete out.linkedin;
  }
  return out;
}

// Call the local LLM with a timeout + retry-with-backoff. A timeout, a thrown
// error (server unreachable, mid-load, OOM), or an empty completion all count
// as "didn't respond" → wait and try again. Returns the trimmed text, or throws
// once every attempt is exhausted. Malformed-but-present JSON is NOT retried
// here — that's the caller's reprompt loop, since the server clearly answered.
async function callLLMWithRetry({ system, messages, model, baseUrl }: { system: string; messages: LlmMessage[]; model: string; baseUrl: string }) {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= LLM_MAX_ATTEMPTS; attempt++) {
    try {
      const { content } = (await localProvider.streamTurn({
        model,
        system,
        messages,
        mcpTools: [],
        providerConfig: { baseUrl },
        timeoutMs: LLM_TIMEOUT_MS,
      }))!;
      const text = (content || [])
        .filter((b: any) => b?.type === 'text')
        .map((b: any) => b.text)
        .join('')
        .trim();
      if (!text) throw new Error('local LLM returned an empty response');
      return text;
    } catch (err) {
      lastErr = err;
      if (attempt < LLM_MAX_ATTEMPTS) {
        const waitMs = Math.min(LLM_RETRY_BASE_MS * 2 ** (attempt - 1), LLM_RETRY_MAX_MS);
        logger.warn(
          { event: 'enrichment.llm_retry', attempt, maxAttempts: LLM_MAX_ATTEMPTS, waitMs, err: (err as Error).message || String(err) },
          `local LLM call failed (attempt ${attempt}/${LLM_MAX_ATTEMPTS}) — waiting ${waitMs}ms before retry`,
        );
        await sleep(waitMs);
      }
    }
  }
  throw new Error(`local LLM call failed after ${LLM_MAX_ATTEMPTS} attempts: ${(lastErr as Error)?.message || String(lastErr)}`);
}

async function formatWithLocalLLM({ name, accountName, research, baseUrl, model }: { name: string; accountName?: string | null; research: unknown; baseUrl?: string | null; model?: string | null }) {
  // Truncate the research blob — local models often have 8-32K context and
  // we don't want a runaway profile crashing the call. 10K of JSON is plenty
  // for the meaningful fields the formatter cares about.
  const researchText = JSON.stringify(research || {}, null, 2).slice(0, 10000);
  const userPrompt = `Person: ${name}
Company: ${accountName || 'unknown'}

Research blob (raw JSON, may be truncated):
${researchText}

Return ONLY the JSON object specified in the system prompt.`;

  const messages: LlmMessage[] = [{ role: 'user', content: userPrompt }];
  // Caller (ContactEnrichmentService) resolves the user's saved settings and
  // passes baseUrl/model in. Env vars are a last-resort fallback only.
  const effectiveModel = model
    || process.env.CONTACT_ENRICHMENT_MODEL
    || process.env.LOCAL_MODEL
    || 'local';
  const effectiveBaseUrl = baseUrl || process.env.LOCAL_BASE_URL || null;
  if (!effectiveBaseUrl) {
    throw new Error('No local LLM URL configured — set it in Settings → Agent LLM (or LOCAL_BASE_URL env var).');
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await callLLMWithRetry({
      system: FORMAT_SYSTEM_PROMPT,
      messages,
      model: effectiveModel,
      baseUrl: effectiveBaseUrl,
    });
    const parsed = parseLooseJson(text);
    const cleaned = validateAndClean(parsed);
    if (cleaned && Object.keys(cleaned).length > 0) return cleaned;
    // Content (not transport) failure: the model answered but the JSON was
    // unusable. Reprompt with corrective guidance — no backoff needed, the
    // server is clearly healthy.
    messages.push({ role: 'assistant', content: [{ type: 'text', text }] });
    messages.push({
      role: 'user',
      content: [{
        type: 'text',
        text: 'That response was not valid JSON, or contained no usable fields. Return ONLY the JSON object specified in the system prompt — no surrounding text, no code fences, no commentary. Use null for fields you cannot determine.',
      }],
    });
  }
  return null;
}
