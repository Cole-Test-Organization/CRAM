import { randomUUID } from "node:crypto";
import { withUser } from "../../db/connection.js";
import { logger as rootLogger } from "../../lib/logger.js";
import type { ResourceBroker } from "./resourceBroker.js";
import type { PostgresStateRepository } from "./state/postgresStateRepository.js";
import type { SecretResolver } from "./secrets/index.js";
import { clearSecretOverlay, installSecretOverlay } from "./utils/secretSource.js";
import { clearJobSignal, installJobSignal } from "./utils/jobSignal.js";
import { nowIso } from "./utils/index.js";
import type { JobSpec } from "./jobView.js";
import type { JobRecord } from "./types/index.js";
import type { LogFn } from "./types/logging.js";

const logger = rootLogger.child({ component: "provisioning-worker" });

export interface ProvisioningJobWorkerOptions {
  userId: number;
  broker: ResourceBroker;
  store: PostgresStateRepository;
  secretResolver: SecretResolver;
  /** Idle poll interval between claim attempts (ms). */
  pollMs?: number;
  /** How often a running job checks for a cancel request (ms). */
  cancelPollMs?: number;
}

// Durable DB-claim worker that replaces the broker's in-memory `activeJobId` lock.
// Claims one queued `provisioning_jobs` row at a time with FOR UPDATE SKIP LOCKED
// (multi-replica safe), runs the broker lifecycle verb with a Postgres-streaming
// log, and finalizes the row. Single user + serial execution (one running job per
// process, enforced by the NOT EXISTS guard) make the process-global secret + abort
// overlays unambiguous. On boot it fails any job left 'running' by a dead process.
export class ProvisioningJobWorker {
  private readonly userId: number;
  private readonly broker: ResourceBroker;
  private readonly store: PostgresStateRepository;
  private readonly secretResolver: SecretResolver;
  private readonly pollMs: number;
  private readonly cancelPollMs: number;
  private readonly workerId = `provisioning-${process.pid}-${randomUUID().slice(0, 8)}`;
  private running = false;
  private loopPromise: Promise<void> | null = null;

  constructor(options: ProvisioningJobWorkerOptions) {
    this.userId = options.userId;
    this.broker = options.broker;
    this.store = options.store;
    this.secretResolver = options.secretResolver;
    this.pollMs = options.pollMs ?? 1500;
    this.cancelPollMs = options.cancelPollMs ?? 2000;
  }

  async start(): Promise<void> {
    if (this.running) return;
    const recovered = await this.recoverOrphans();
    if (recovered > 0) logger.warn({ recovered }, "failed orphaned running jobs from a previous process");
    this.running = true;
    this.loopPromise = this.loop();
    logger.info({ workerId: this.workerId }, "provisioning job worker started");
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loopPromise?.catch(() => undefined);
    this.loopPromise = null;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      let row: Record<string, unknown> | null = null;
      try {
        row = await this.claim();
      } catch (err) {
        logger.error({ err: errMessage(err) }, "claim failed");
        await sleep(this.pollMs);
        continue;
      }
      if (!row) {
        await sleep(this.pollMs);
        continue;
      }
      await this.runJob(row);
    }
  }

  // Atomically promote the oldest queued job to 'running'. The broker_state row is
  // the per-user mutex: FOR UPDATE serializes claim attempts across replicas, then
  // active_job_id is set in the same transaction as the job claim. SKIP LOCKED
  // still protects the claimed job row itself; the state-row lock is what prevents
  // two replicas from each seeing "no running job" and claiming different rows.
  private async claim(): Promise<Record<string, unknown> | null> {
    return withUser(this.userId, async (c) => {
      await c.query(
        `INSERT INTO broker_state (user_id, active_job_id)
         VALUES ($1, NULL)
         ON CONFLICT (user_id) DO NOTHING`,
        [this.userId],
      );

      const state = await c.query<{ active_job_id: string | null }>(
        `SELECT active_job_id FROM broker_state WHERE user_id = $1 FOR UPDATE`,
        [this.userId],
      );
      if (state.rows[0]?.active_job_id) return null;

      const res = await c.query(
        `WITH claimable AS (
           SELECT id FROM provisioning_jobs
            WHERE status = 'queued'
            ORDER BY created_at
            FOR UPDATE SKIP LOCKED
            LIMIT 1
         )
         UPDATE provisioning_jobs j
            SET status = 'running', claimed_by = $1, claimed_at = NOW(),
                started_at = COALESCE(j.started_at, NOW())
           FROM claimable
          WHERE j.id = claimable.id
         RETURNING j.*`,
        [this.workerId],
      );
      const row = res.rows[0] ?? null;
      if (!row) return null;

      await c.query(
        `UPDATE broker_state SET active_job_id = $2 WHERE user_id = $1`,
        [this.userId, row.id],
      );
      return row;
    });
  }

  private async runJob(row: Record<string, unknown>): Promise<void> {
    const spec = (row.params ?? {}) as JobSpec;
    const job: JobRecord = {
      id: row.id as string,
      action: row.action as string,
      hostname: (row.hostname as string | null) ?? undefined,
      status: "running",
      startedAt: row.started_at instanceof Date ? row.started_at.toISOString() : nowIso(),
      logs: [],
    };

    // Serialize saveJob so the append-only log diff (count → insert slice) never
    // races, while keeping per-line streaming to the GUI.
    let writeChain: Promise<void> = Promise.resolve();
    const persist = (): Promise<void> => {
      writeChain = writeChain
        .then(() => this.store.saveJob(job))
        .catch((err) => logger.warn({ err: errMessage(err), jobId: job.id }, "saveJob failed"));
      return writeChain;
    };
    const log: LogFn = (line) => {
      job.logs.push(`[${new Date().toLocaleTimeString()}] ${line}`);
      void persist();
    };

    await this.store.setActiveJob(job.id);
    const abort = new AbortController();
    installJobSignal(abort.signal);
    installSecretOverlay(await this.secretResolver.hydrateAll());

    let canceled = false;
    const cancelTimer = setInterval(() => {
      void this.isCancelRequested(job.id)
        .then((requested) => {
          if (requested && !canceled) {
            canceled = true;
            log("Cancellation requested — terminating the running step…");
            abort.abort();
          }
        })
        .catch(() => undefined);
    }, this.cancelPollMs);

    logger.info({ jobId: job.id, action: job.action, target: job.hostname }, "running provisioning job");
    try {
      await this.dispatch(job, spec, log);
      job.status = "succeeded";
    } catch (err) {
      if (canceled || abort.signal.aborted) {
        job.status = "canceled";
        job.error = "canceled by user";
        log("Job canceled.");
      } else {
        job.status = "failed";
        job.error = errMessage(err);
        job.logs.push(`[${new Date().toLocaleTimeString()}] ERROR: ${job.error}`);
      }
    } finally {
      clearInterval(cancelTimer);
      clearJobSignal();
      clearSecretOverlay();
      job.finishedAt = nowIso();
      await persist();
      await this.store.setActiveJob(null);
      logger.info({ jobId: job.id, status: job.status }, "provisioning job finished");
    }
  }

  private async dispatch(job: JobRecord, spec: JobSpec, log: LogFn): Promise<void> {
    const options = { params: spec.runParams ?? undefined, skipActiveJobCheck: true };
    const deployment = spec.deploymentRef ?? undefined;
    switch (job.action) {
      case "deploy":
        await this.broker.deploy(requireRef(deployment, "deploy"), log, options);
        return;
      case "deprovision":
        await this.broker.deprovision(requireRef(deployment, "deprovision"), log, options);
        return;
      case "up":
        await this.broker.up(requireRef(deployment, "up"), log, requireTarget(job.hostname, "up"), options);
        return;
      case "down":
        await this.broker.down(requireTarget(job.hostname, "down"), log, options);
        return;
      case "run-action":
        await this.broker.runAction(
          requireRef(deployment, "run-action"),
          requireTarget(job.hostname, "run-action"),
          requireRef(spec.resourceAction, "run-action resourceAction"),
          log,
          options,
        );
        return;
      default:
        throw new Error(`unknown job action "${job.action}"`);
    }
  }

  private async isCancelRequested(id: string): Promise<boolean> {
    return withUser(this.userId, async (c) => {
      const res = await c.query<{ cancel_requested: boolean }>(
        `SELECT cancel_requested FROM provisioning_jobs WHERE id = $1`,
        [id],
      );
      return Boolean(res.rows[0]?.cancel_requested);
    });
  }

  // Boot recovery: a job still 'running' belongs to a process that died mid-apply.
  // We can't safely resume terraform, so fail it (the user retries) and clear the
  // serial guard. (Single replica: any running job is ours-from-before. Multi-
  // replica recovery would scope by claimed_by + a heartbeat — future work.)
  private async recoverOrphans(): Promise<number> {
    return withUser(this.userId, async (c) => {
      const res = await c.query(
        `UPDATE provisioning_jobs
            SET status = 'failed',
                error = COALESCE(error, 'interrupted by an API restart'),
                finished_at = NOW()
          WHERE status = 'running'
         RETURNING id`,
      );
      await c.query(`UPDATE broker_state SET active_job_id = NULL WHERE active_job_id IS NOT NULL`);
      return res.rowCount ?? 0;
    });
  }
}

function requireRef(value: string | null | undefined, label: string): string {
  if (!value) throw new Error(`${label} job is missing its deployment reference`);
  return value;
}

function requireTarget(value: string | undefined, label: string): string {
  if (!value) throw new Error(`${label} job is missing its target resource`);
  return value;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
