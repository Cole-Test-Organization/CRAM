import type { PoolClient } from "pg";
import { withUser } from "../../../db/connection.js";
import type { BrokerEventBus } from "../events.js";
import { nowIso } from "../utils/index.js";
import type { BrokerState, JobRecord, ResourceRecord } from "../types/index.js";
import { normalizeResourceRecord, StateRepository } from "./stateRepository.js";

// Postgres-backed StateRepository (Phase 2 of the broker migration). It extends the
// abstract base for type-compatibility and the shared event bus, but it does NOT use
// the whole-state/whole-jobs blob hooks — those would force read-modify-write of the
// entire state on every change and destroy the row-level concurrency the DB-claim
// worker depends on. Instead it overrides each granular public op with targeted SQL,
// reusing the base's normalization (deterministic res_<sha1> ids, path-relativization)
// so records are byte-identical to the file repository's.
//
// Impedance mappings vs the broker's in-memory shapes:
//   - ResourceRecord.deploymentId is a string slug (e.g. "aws-gp-lab"); the schema's
//     provisioned_resources.deployment_id is a BIGINT FK. We resolve slug -> id via
//     deployments.name (the seed stores the slug there) and map back on read.
//   - ResourceRecord.configPath has no column (Phase 0 dropped it for the FK); on read
//     we reconstruct it as the deployment slug — the logical ref PostgresConfigRepository
//     accepts — which keeps inferDeploymentId(configPath) === deploymentId.
//   - terraformStatePath <-> terraform_workspace transitionally, until the Terraform
//     pg-backend work renames the concept to a workspace per resource.
//   - All queries run under withUser(); forced RLS scopes them to this user, so the
//     explicit user_id is only needed where a column requires it.
export class PostgresStateRepository extends StateRepository {
  constructor(
    private readonly userId: number,
    events?: BrokerEventBus,
  ) {
    super(events);
  }

  // ── unused blob hooks (PG overrides every granular public op) ───────────────
  protected async readState(): Promise<BrokerState> {
    throw new Error("PostgresStateRepository uses granular SQL, not whole-state reads");
  }
  protected async writeState(): Promise<void> {
    throw new Error("PostgresStateRepository uses granular SQL, not whole-state writes");
  }
  protected async readJobs(): Promise<JobRecord[]> {
    throw new Error("PostgresStateRepository uses granular SQL, not whole-jobs reads");
  }
  protected async writeJobs(): Promise<void> {
    throw new Error("PostgresStateRepository uses granular SQL, not whole-jobs writes");
  }

  // ── resources ───────────────────────────────────────────────────────────────
  override async getState(): Promise<BrokerState> {
    return withUser(this.userId, async (c) => {
      const active = await c.query<{ active_job_id: string | null }>(
        `SELECT active_job_id FROM broker_state WHERE user_id = $1`,
        [this.userId],
      );
      const rows = await c.query(`${SELECT_RESOURCE} ORDER BY r.hostname`);
      const resources: Record<string, ResourceRecord> = {};
      for (const row of rows.rows) {
        const record = rowToResourceRecord(row);
        resources[record.id] = record;
      }
      return { activeJobId: active.rows[0]?.active_job_id ?? null, schemaVersion: 2, resources };
    });
  }

  override async listResources(): Promise<ResourceRecord[]> {
    return withUser(this.userId, async (c) => {
      const rows = await c.query(`${SELECT_RESOURCE} ORDER BY r.hostname`);
      return rows.rows.map(rowToResourceRecord);
    });
  }

  override async getResource(target: string): Promise<ResourceRecord | null> {
    return withUser(this.userId, async (c) => {
      const rows = await c.query(
        `${SELECT_RESOURCE} WHERE r.id = $1 OR r.hostname = $1 OR r.name = $1 LIMIT 1`,
        [target],
      );
      return rows.rows.length ? rowToResourceRecord(rows.rows[0]) : null;
    });
  }

  override async upsertResource(record: ResourceRecord): Promise<ResourceRecord> {
    const normalized = normalizeResourceRecord(record);
    await withUser(this.userId, async (c) => {
      const deploymentId = await this.resolveDeploymentId(c, normalized.deploymentId);
      await c.query(UPSERT_RESOURCE, resourceParams(normalized, this.userId, deploymentId));
    });
    this.events.publish({ type: "resource", resource: normalized });
    return normalized;
  }

  override async patchResource(
    target: string,
    patch: Partial<Omit<ResourceRecord, "id">>,
  ): Promise<ResourceRecord> {
    const next = await withUser(this.userId, async (c) => {
      const rows = await c.query(
        `${SELECT_RESOURCE} WHERE r.id = $1 OR r.hostname = $1 OR r.name = $1 LIMIT 1`,
        [target],
      );
      if (!rows.rows.length) {
        throw new Error(`No resource named ${target} exists in broker state`);
      }
      const current = rowToResourceRecord(rows.rows[0]);
      const merged = normalizeResourceRecord({
        ...current,
        ...patch,
        id: current.id,
        updatedAt: nowIso(),
      });
      const deploymentId = await this.resolveDeploymentId(c, merged.deploymentId);
      await c.query(UPSERT_RESOURCE, resourceParams(merged, this.userId, deploymentId));
      return merged;
    });
    this.events.publish({ type: "resource", resource: next });
    return next;
  }

  // ── active job (broker_state singleton) ──────────────────────────────────────
  override async setActiveJob(jobId: string | null): Promise<void> {
    await withUser(this.userId, async (c) => {
      await c.query(
        `INSERT INTO broker_state (user_id, active_job_id) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET active_job_id = EXCLUDED.active_job_id`,
        [this.userId, jobId],
      );
    });
    this.events.publish({ type: "active-job", activeJobId: jobId });
  }

  // ── jobs (+ child log rows) ──────────────────────────────────────────────────
  override async getJobs(): Promise<JobRecord[]> {
    return withUser(this.userId, async (c) => {
      const jobs = await c.query(
        `SELECT id, action, hostname, status, started_at, finished_at, error
           FROM provisioning_jobs ORDER BY created_at DESC LIMIT 50`,
      );
      const out: JobRecord[] = [];
      for (const job of jobs.rows) {
        const logs = await c.query<{ line: string }>(
          `SELECT line FROM provisioning_job_logs WHERE job_id = $1 ORDER BY id`,
          [job.id],
        );
        out.push(rowToJobRecord(job, logs.rows.map((r) => r.line)));
      }
      return out;
    });
  }

  override async saveJob(job: JobRecord): Promise<void> {
    const saved = structuredClone(job);
    await withUser(this.userId, async (c) => {
      await c.query(
        `INSERT INTO provisioning_jobs (id, user_id, action, hostname, status, started_at, finished_at, error)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           status      = EXCLUDED.status,
           hostname    = EXCLUDED.hostname,
           finished_at = EXCLUDED.finished_at,
           error       = EXCLUDED.error`,
        [
          job.id,
          this.userId,
          job.action,
          job.hostname ?? null,
          job.status,
          job.startedAt ?? null,
          job.finishedAt ?? null,
          job.error ?? null,
        ],
      );
      // Logs are append-only child rows; the broker re-sends the whole growing
      // array on every line, so append only the lines we haven't persisted yet.
      const countRes = await c.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM provisioning_job_logs WHERE job_id = $1`,
        [job.id],
      );
      const persisted = countRes.rows[0]?.n ?? 0;
      const fresh = (job.logs ?? []).slice(persisted);
      for (const line of fresh) {
        await c.query(`INSERT INTO provisioning_job_logs (job_id, line) VALUES ($1, $2)`, [job.id, line]);
      }
    });
    this.events.publish({ type: "job", job: saved });
  }

  private async resolveDeploymentId(c: PoolClient, slug: string): Promise<number> {
    const res = await c.query<{ id: number }>(`SELECT id FROM deployments WHERE name = $1`, [slug]);
    if (!res.rows.length) {
      throw new Error(
        `deployment "${slug}" is not persisted; create/seed it before provisioning its resources`,
      );
    }
    return res.rows[0].id;
  }
}

// deployment_name is joined in so reads can map the FK back to the broker's string slug.
const SELECT_RESOURCE = `
  SELECT r.*, d.name AS deployment_name
    FROM provisioned_resources r
    JOIN deployments d ON d.id = r.deployment_id`;

const UPSERT_RESOURCE = `
  INSERT INTO provisioned_resources (
    id, user_id, deployment_id, name, hostname, kind, lifecycle_status, provider,
    vm_id, provider_resource_id, auth_code, serial, bootstrap_iso_path,
    bootstrap_iso_file_id, terraform_workspace, panos, outputs, last_job_id,
    power_state, power_state_checked_at
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
    $16::jsonb, $17::jsonb, $18, $19, $20
  )
  ON CONFLICT (id) DO UPDATE SET
    deployment_id          = EXCLUDED.deployment_id,
    name                   = EXCLUDED.name,
    hostname               = EXCLUDED.hostname,
    kind                   = EXCLUDED.kind,
    lifecycle_status       = EXCLUDED.lifecycle_status,
    provider               = EXCLUDED.provider,
    vm_id                  = EXCLUDED.vm_id,
    provider_resource_id   = EXCLUDED.provider_resource_id,
    auth_code              = EXCLUDED.auth_code,
    serial                 = EXCLUDED.serial,
    bootstrap_iso_path     = EXCLUDED.bootstrap_iso_path,
    bootstrap_iso_file_id  = EXCLUDED.bootstrap_iso_file_id,
    terraform_workspace    = EXCLUDED.terraform_workspace,
    panos                  = EXCLUDED.panos,
    outputs                = EXCLUDED.outputs,
    last_job_id            = EXCLUDED.last_job_id,
    power_state            = EXCLUDED.power_state,
    power_state_checked_at = EXCLUDED.power_state_checked_at`;

function resourceParams(r: ResourceRecord, userId: number, deploymentId: number): unknown[] {
  return [
    r.id,
    userId,
    deploymentId,
    r.name ?? null,
    r.hostname,
    r.kind ?? null,
    r.lifecycleStatus,
    r.provider ?? null,
    r.vmId ?? null,
    r.providerResourceId ?? null,
    r.authCode ?? null,
    r.serial ?? null,
    r.bootstrapIsoPath ?? null,
    r.bootstrapIsoFileId ?? null,
    r.terraformStatePath ?? null,
    r.panos == null ? null : JSON.stringify(r.panos),
    r.outputs == null ? null : JSON.stringify(r.outputs),
    r.lastJobId ?? null,
    r.powerState ?? null,
    r.powerStateCheckedAt ?? null,
  ];
}

function toIso(value: unknown): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function rowToResourceRecord(row: Record<string, unknown>): ResourceRecord {
  const slug = (row.deployment_name as string) ?? "";
  return {
    id: row.id as string,
    deploymentId: slug,
    name: (row.name as string | null) ?? null,
    hostname: row.hostname as string,
    kind: (row.kind as ResourceRecord["kind"]) ?? null,
    lifecycleStatus: row.lifecycle_status as ResourceRecord["lifecycleStatus"],
    configPath: slug,
    provider: (row.provider as ResourceRecord["provider"]) ?? null,
    vmId: (row.vm_id as number | null) ?? null,
    providerResourceId: (row.provider_resource_id as string | null) ?? null,
    authCode: (row.auth_code as string | null) ?? null,
    serial: (row.serial as string | null) ?? null,
    bootstrapIsoPath: (row.bootstrap_iso_path as string | null) ?? null,
    bootstrapIsoFileId: (row.bootstrap_iso_file_id as string | null) ?? null,
    terraformStatePath: (row.terraform_workspace as string | null) ?? null,
    panos: (row.panos as ResourceRecord["panos"]) ?? null,
    outputs: (row.outputs as ResourceRecord["outputs"]) ?? null,
    lastJobId: (row.last_job_id as string | null) ?? null,
    powerState: (row.power_state as ResourceRecord["powerState"]) ?? null,
    powerStateCheckedAt: toIso(row.power_state_checked_at),
    updatedAt: toIso(row.updated_at) ?? nowIso(),
  };
}

function rowToJobRecord(row: Record<string, unknown>, logs: string[]): JobRecord {
  return {
    id: row.id as string,
    action: row.action as string,
    hostname: (row.hostname as string | undefined) ?? undefined,
    status: row.status as JobRecord["status"],
    startedAt: toIso(row.started_at) ?? nowIso(),
    finishedAt: toIso(row.finished_at) ?? undefined,
    logs,
    error: (row.error as string | undefined) ?? undefined,
  };
}
