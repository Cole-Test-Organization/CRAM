import { randomUUID } from "node:crypto";
import { withUser } from "../../db/connection.js";
import { ResourceBroker } from "./resourceBroker.js";
import { PostgresStateRepository } from "./state/postgresStateRepository.js";
import { PostgresConfigRepository } from "./config/postgresConfigRepository.js";
import { seedProvisioningConfig, type SeedResult } from "./config/seed.js";
import { SecretsService, SecretResolver, type SecretSummary } from "./secrets/index.js";
import { createDefaultResourceAdapterRegistry } from "./resources/index.js";
import { rowToJobView, type JobSpec, type JobView } from "./jobView.js";
import type {
  DeploymentDescriptor,
  DeploymentSummary,
  ResourceRecord,
} from "./types/index.js";

const NOOP_LOG = () => undefined;

export type JobKind = "deploy" | "deprovision" | "up" | "down" | "run-action";
const JOB_KINDS = new Set<JobKind>(["deploy", "deprovision", "up", "down", "run-action"]);

export interface EnqueueJobInput {
  kind: JobKind;
  /** Deployment slug — required for deploy/deprovision/up/run-action. */
  deployment?: string | null;
  /** Resource hostname or id — required for up/down/run-action. */
  target?: string | null;
  /** Resource-action name — required for run-action. */
  resourceAction?: string | null;
  /** Deploy-time step toggles (the broker's `when` params). */
  params?: Record<string, unknown> | null;
}

export interface ProvisioningServiceOptions {
  userId: number;
  broker?: ResourceBroker;
  store?: PostgresStateRepository;
  config?: PostgresConfigRepository;
  secrets?: SecretsService;
}

function httpError(statusCode: number, message: string): Error {
  return Object.assign(new Error(message), { statusCode });
}

// In-process facade the API/MCP/GUI surfaces call. Pins the broker to the single
// default user (auth is out of scope — one user, forever) with Postgres-backed
// config + state + encrypted secrets and the Terraform `pg` backend. Lifecycle
// verbs (up/down/deploy/deprovision/run-action) are NOT executed here — they're
// enqueued as durable `provisioning_jobs` rows and run by ProvisioningJobWorker,
// so a slow terraform apply never blocks a request and survives a restart. Reads
// (deployments, resources, jobs) and quick power toggles run inline.
export class ProvisioningService {
  readonly userId: number;
  readonly broker: ResourceBroker;
  readonly store: PostgresStateRepository;
  readonly config: PostgresConfigRepository;
  readonly secrets: SecretsService;
  readonly secretResolver: SecretResolver;

  constructor(options: ProvisioningServiceOptions) {
    this.userId = options.userId;
    this.config = options.config ?? new PostgresConfigRepository(this.userId);
    this.store = options.store ?? new PostgresStateRepository(this.userId);
    this.secrets = options.secrets ?? new SecretsService();
    this.secretResolver = new SecretResolver(this.userId, this.secrets);
    this.broker =
      options.broker ??
      new ResourceBroker({
        store: this.store,
        configRepository: this.config,
        secretResolver: this.secretResolver,
        resourceAdapters: createDefaultResourceAdapterRegistry(),
      });
  }

  // ── discovery (reads — never blocked by an active job) ──────────────────────
  async listDeployments(): Promise<DeploymentSummary[]> {
    return this.config.listDeployments();
  }

  async getDeployment(id: string): Promise<DeploymentDescriptor | null> {
    return this.config.getDeployment(id);
  }

  // ── resources (reads + quick provider-read power refresh) ───────────────────
  async listResources(): Promise<ResourceRecord[]> {
    return this.broker.listResources();
  }

  async getResource(target: string): Promise<ResourceRecord | null> {
    return this.broker.getResource(target);
  }

  // Provider-read-only against the cloud; patches power_state so subscribers see
  // fresh status. skipActiveJobCheck so status reads work during a lifecycle job.
  async refreshPowerState(target: string): Promise<ResourceRecord> {
    return this.broker.refreshResourcePowerState(target, NOOP_LOG, { skipActiveJobCheck: true });
  }

  // ── power (quick, mutating — refused while a lifecycle job is active) ────────
  async startResource(target: string): Promise<ResourceRecord> {
    await this.assertIdle();
    return this.broker.startResource(target, NOOP_LOG);
  }

  async stopResource(target: string): Promise<ResourceRecord> {
    await this.assertIdle();
    return this.broker.stopResource(target, NOOP_LOG);
  }

  // ── secrets (encrypted at rest; values never returned) ──────────────────────
  async listSecrets(): Promise<SecretSummary[]> {
    return this.secrets.listSecrets(this.userId);
  }

  async setSecret(name: string, value: string, description?: string | null): Promise<{ name: string }> {
    return this.secrets.setSecret(this.userId, name, value, description ?? null);
  }

  async deleteSecret(name: string): Promise<boolean> {
    return this.secrets.deleteSecret(this.userId, name);
  }

  // ── config seed (idempotent import of the shipped database/*.yaml) ──────────
  async seed(): Promise<SeedResult> {
    return seedProvisioningConfig(this.userId);
  }

  // ── jobs (enqueue → worker executes; poll + cancel) ─────────────────────────
  async enqueueJob(input: EnqueueJobInput): Promise<JobView> {
    const kind = input.kind;
    if (!JOB_KINDS.has(kind)) {
      throw httpError(400, `unknown job kind "${kind}" — use ${[...JOB_KINDS].join(", ")}`);
    }

    const deployment = input.deployment?.trim() || null;
    const target = input.target?.trim() || null;
    const resourceAction = input.resourceAction?.trim() || null;

    if (kind !== "down" && !deployment) {
      throw httpError(400, `${kind} requires a deployment slug`);
    }
    if ((kind === "up" || kind === "down" || kind === "run-action") && !target) {
      throw httpError(400, `${kind} requires a target resource`);
    }
    if (kind === "run-action" && !resourceAction) {
      throw httpError(400, "run-action requires a resourceAction name");
    }

    // Resolve (and validate) the deployment FK. Resources can only be provisioned
    // for a seeded deployment — fail fast with a clear message rather than deep in
    // the worker.
    let deploymentId: number | null = null;
    if (deployment) {
      deploymentId = await this.resolveDeploymentId(deployment);
      if (deploymentId == null) {
        throw httpError(400, `deployment "${deployment}" is not seeded — POST /api/provisioning/seed first`);
      }
    }
    if (kind === "down") {
      const record = await this.broker.getResource(target as string);
      if (!record) throw httpError(404, `no provisioned resource "${target}"`);
    }

    const spec: JobSpec = {
      deploymentRef: deployment,
      resourceAction,
      runParams: input.params ?? null,
    };
    const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;

    const row = await withUser(this.userId, async (c) => {
      const res = await c.query(
        `INSERT INTO provisioning_jobs (id, user_id, deployment_id, action, hostname, params, status)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'queued')
         RETURNING *`,
        [id, this.userId, deploymentId, kind, target, JSON.stringify(spec)],
      );
      return res.rows[0];
    });
    return rowToJobView(row);
  }

  async getJob(id: string): Promise<JobView | null> {
    return withUser(this.userId, async (c) => {
      const res = await c.query(`${SELECT_JOB} WHERE j.id = $1`, [id]);
      if (!res.rows.length) return null;
      const logs = await c.query<{ line: string }>(
        `SELECT line FROM provisioning_job_logs WHERE job_id = $1 ORDER BY id`,
        [id],
      );
      return rowToJobView(res.rows[0], logs.rows.map((r) => r.line));
    });
  }

  async listJobs(options: { status?: string; limit?: number } = {}): Promise<JobView[]> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    return withUser(this.userId, async (c) => {
      const res = options.status
        ? await c.query(`${SELECT_JOB} WHERE j.status = $1 ORDER BY j.created_at DESC LIMIT $2`, [options.status, limit])
        : await c.query(`${SELECT_JOB} ORDER BY j.created_at DESC LIMIT $1`, [limit]);
      return res.rows.map((r) => rowToJobView(r));
    });
  }

  // Queued jobs are canceled immediately; running jobs get the cancel_requested
  // flag the worker polls (it kills the terraform child and transitions the job).
  async requestCancel(id: string): Promise<JobView | null> {
    const found = await withUser(this.userId, async (c) => {
      const res = await c.query<{ status: string }>(`SELECT status FROM provisioning_jobs WHERE id = $1`, [id]);
      if (!res.rows.length) return false;
      const status = res.rows[0].status;
      if (status === "queued") {
        await c.query(
          `UPDATE provisioning_jobs
             SET status = 'canceled', cancel_requested = TRUE, finished_at = NOW(),
                 error = COALESCE(error, 'canceled before start')
           WHERE id = $1`,
          [id],
        );
        await c.query(`UPDATE broker_state SET active_job_id = NULL WHERE active_job_id = $1`, [id]);
      } else if (status === "running") {
        await c.query(`UPDATE provisioning_jobs SET cancel_requested = TRUE WHERE id = $1`, [id]);
      }
      return true;
    });
    return found ? this.getJob(id) : null;
  }

  private async resolveDeploymentId(slug: string): Promise<number | null> {
    return withUser(this.userId, async (c) => {
      const res = await c.query<{ id: number }>(`SELECT id FROM deployments WHERE name = $1`, [slug]);
      return res.rows.length ? res.rows[0].id : null;
    });
  }

  private async assertIdle(): Promise<void> {
    const state = await this.store.getState();
    if (state.activeJobId) {
      throw httpError(409, `a provisioning job is active (${state.activeJobId}); retry once it finishes`);
    }
  }
}

const SELECT_JOB = `
  SELECT j.*, d.name AS deployment_name
    FROM provisioning_jobs j
    LEFT JOIN deployments d ON d.id = j.deployment_id`;
