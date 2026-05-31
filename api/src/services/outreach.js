import crypto from 'crypto';
import { researchPerson } from '../../../outreach/src/commands/person.js';
import { researchCompany } from '../../../outreach/src/commands/company.js';
import { researchIndustry } from '../../../outreach/src/commands/industry.js';
import { getRateLimitStats } from '../../../outreach/src/utils/ratelimit.js';
import { logger as rootLogger } from '../lib/logger.js';
import { badRequest } from '../lib/http-error.js';

const logger = rootLogger.child({ component: 'outreach-worker' });

const VALID_TYPES = new Set(['person', 'company', 'industry']);
const MAX_JOBS_IN_MEMORY = 200;

export class OutreachService {
  constructor() {
    this.jobs = new Map();
    this.queue = [];
    this.running = false;
  }

  enqueue({ type, name, company, title, deep, limit, linkedin = true }) {
    if (!VALID_TYPES.has(type)) {
      throw badRequest(`Unknown outreach type: ${type}. Must be one of: ${[...VALID_TYPES].join(', ')}.`);
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw badRequest('Enrichment requires a non-empty `name`.');
    }

    const jobId = crypto.randomUUID();
    const job = {
      jobId,
      type,
      params: { name: name.trim(), company, title, deep: !!deep, limit, linkedin: !!linkedin },
      status: 'queued',
      result: null,
      error: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
    };
    this.jobs.set(jobId, job);
    this.queue.push(jobId);
    this._evictOldJobs();
    this._run().catch((err) => {
      logger.error({ event: 'outreach.worker_crashed', err: err.message, stack: err.stack }, 'outreach worker crashed');
      this.running = false;
    });
    return this._publicView(job, { includePosition: true });
  }

  getJob(jobId) {
    const job = this.jobs.get(jobId);
    return job ? this._publicView(job) : null;
  }

  listJobs({ status, limit = 50 } = {}) {
    let jobs = [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (status) jobs = jobs.filter((j) => j.status === status);
    return jobs.slice(0, limit).map((j) => this._publicView(j));
  }

  async getStats() {
    const jobs = [...this.jobs.values()];
    const rateLimit = await getRateLimitStats();
    return {
      queue: {
        pending: this.queue.length,
        running: this.running,
      },
      jobs: {
        total: jobs.length,
        queued: jobs.filter((j) => j.status === 'queued').length,
        running: jobs.filter((j) => j.status === 'running').length,
        completed: jobs.filter((j) => j.status === 'completed').length,
        failed: jobs.filter((j) => j.status === 'failed').length,
      },
      rateLimit,
    };
  }

  async _run() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const jobId = this.queue.shift();
        const job = this.jobs.get(jobId);
        if (!job) continue;
        job.status = 'running';
        job.startedAt = new Date().toISOString();
        try {
          job.result = await this._execute(job);
          job.status = 'completed';
        } catch (err) {
          job.error = err.message || String(err);
          job.status = 'failed';
        }
        job.completedAt = new Date().toISOString();
      }
    } finally {
      this.running = false;
    }
  }

  async _execute(job) {
    const { type, params } = job;
    const baseOpts = {
      headless: true,
      autoRelogin: false,
      linkedin: params.linkedin,
      deep: params.deep,
    };
    switch (type) {
      case 'person':
        return researchPerson(params.name, {
          ...baseOpts,
          company: params.company,
          title: params.title,
        });
      case 'company':
        return researchCompany(params.name, baseOpts);
      case 'industry':
        return researchIndustry(params.name, {
          ...baseOpts,
          limit: params.limit,
        });
      default:
        throw new Error(`Unknown outreach type: ${type}`);
    }
  }

  _publicView(job, { includePosition = false } = {}) {
    const view = {
      jobId: job.jobId,
      type: job.type,
      params: job.params,
      status: job.status,
      result: job.result,
      error: job.error,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    };
    if (includePosition && job.status === 'queued') {
      view.position = this.queue.indexOf(job.jobId) + 1;
    }
    return view;
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
