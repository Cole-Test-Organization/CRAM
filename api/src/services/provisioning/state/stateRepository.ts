import { createHash } from "node:crypto";
import path from "node:path";
import type {
  BrokerState,
  JobRecord,
  ResourceRecord,
} from "../types/index.js";
import { BrokerEventBus } from "../events.js";
import { nowIso } from "../utils/index.js";
import { toProjectRelativePath } from "../utils/paths.js";

const emptyState: BrokerState = {
  activeJobId: null,
  schemaVersion: 2,
  resources: {},
};

export abstract class StateRepository {
  readonly events: BrokerEventBus;

  private jobSaveQueue: Promise<void> = Promise.resolve();

  constructor(events = new BrokerEventBus()) {
    this.events = events;
  }

  async getState(): Promise<BrokerState> {
    return normalizeState(await this.readState());
  }

  async saveState(state: BrokerState): Promise<void> {
    const normalized = normalizeState(state);
    await this.writeState(normalized);
    this.events.publish({ type: "state", state: normalized });
  }

  async listResources(): Promise<ResourceRecord[]> {
    const state = await this.getState();
    return Object.values(state.resources ?? {});
  }

  async getResource(target: string): Promise<ResourceRecord | null> {
    const state = await this.getState();
    return findResourceRecord(state.resources ?? {}, target)?.record ?? null;
  }

  async upsertResource(record: ResourceRecord): Promise<ResourceRecord> {
    const state = await this.getState();
    const normalized = normalizeResourceRecord(record);
    state.resources ??= {};
    state.resources[normalized.id] = normalized;
    await this.saveState(state);
    this.events.publish({ type: "resource", resource: normalized });
    return normalized;
  }

  async patchResource(
    target: string,
    patch: Partial<Omit<ResourceRecord, "id">>,
  ): Promise<ResourceRecord> {
    const state = await this.getState();
    const match = findResourceRecord(state.resources ?? {}, target);
    if (!match) throw new Error(`No resource named ${target} exists in broker state`);

    const next = normalizeResourceRecord({
      ...match.record,
      ...patch,
      id: match.id,
      updatedAt: nowIso(),
    });
    state.resources ??= {};
    state.resources[match.id] = next;
    await this.saveState(state);
    this.events.publish({ type: "resource", resource: next });
    return next;
  }

  async setActiveJob(jobId: string | null): Promise<void> {
    const state = await this.getState();
    state.activeJobId = jobId;
    await this.saveState(state);
    this.events.publish({ type: "active-job", activeJobId: jobId });
  }

  async getJobs(): Promise<JobRecord[]> {
    return await this.readJobs();
  }

  async saveJob(job: JobRecord): Promise<void> {
    const savedJob = structuredClone(job);
    await this.enqueueJobSave(async () => {
      const jobs = await this.getJobs();
      const index = jobs.findIndex((candidate) => candidate.id === savedJob.id);
      if (index >= 0) {
        jobs[index] = savedJob;
      } else {
        jobs.unshift(savedJob);
      }
      await this.writeJobs(jobs.slice(0, 50));
      this.events.publish({ type: "job", job: savedJob });
    });
  }

  private async enqueueJobSave(operation: () => Promise<void>): Promise<void> {
    const run = this.jobSaveQueue.then(operation, operation);
    this.jobSaveQueue = run.catch(() => undefined);
    await run;
  }

  protected abstract readState(): Promise<BrokerState>;
  protected abstract writeState(state: BrokerState): Promise<void>;
  protected abstract readJobs(): Promise<JobRecord[]>;
  protected abstract writeJobs(jobs: JobRecord[]): Promise<void>;
}

export function emptyBrokerState(): BrokerState {
  return structuredClone(emptyState);
}

export function normalizeState(raw: BrokerState): BrokerState {
  const state: BrokerState = {
    activeJobId: raw.activeJobId ?? null,
    schemaVersion: 2,
    resources: {},
  };

  for (const resource of Object.values(raw.resources ?? {})) {
    const normalized = normalizeResourceRecord(resource);
    state.resources![normalized.id] = normalized;
  }

  return state;
}

export function normalizeResourceRecord(record: ResourceRecord): ResourceRecord {
  const configPath = toProjectRelativePath(record.configPath) ?? record.configPath;
  const deploymentId = record.deploymentId || inferDeploymentId(configPath);
  const hostname = record.hostname;
  return {
    ...record,
    id: record.id || resourceIdFor(deploymentId, hostname),
    deploymentId,
    hostname,
    configPath,
    kind: record.kind ?? null,
    lifecycleStatus: record.lifecycleStatus ?? "idle",
    bootstrapIsoPath: toProjectRelativePath(record.bootstrapIsoPath),
    terraformStatePath: toProjectRelativePath(record.terraformStatePath),
    updatedAt: record.updatedAt ?? nowIso(),
  };
}

export function findResourceRecord(
  resources: Record<string, ResourceRecord>,
  target: string,
): { id: string; record: ResourceRecord } | null {
  for (const [id, record] of Object.entries(resources)) {
    if (id === target || record.hostname === target || record.name === target) {
      return { id, record };
    }
  }
  return null;
}

export function resourceIdFor(deploymentId: string, hostname: string): string {
  const digest = createHash("sha1")
    .update(`${deploymentId}:${hostname}`)
    .digest("hex")
    .slice(0, 12);
  return `res_${digest}`;
}

export function inferDeploymentId(configPath: string): string {
  return path.basename(configPath, path.extname(configPath)) || "default";
}
