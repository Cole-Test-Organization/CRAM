import type {
  DeploymentConfig,
  DeploymentDescriptor,
  DeploymentInput,
  DeploymentStepConfig,
  DeploymentStepSummary,
  DeploymentSummary,
  ProviderConfig,
  TerraformResourceProfile,
} from "../types/index.js";

/**
 * Read-only source of deployment configuration, abstracted away from storage.
 *
 * Subclasses implement only the raw reads (`readDeploymentIds`,
 * `readDeploymentConfig`, `readProviderProfile`, `deploymentRef`). All of the
 * durable logic that shapes the discovery contract — provider-profile merge,
 * input inference, required-env extraction — lives here so it is reused
 * unchanged by a future SQL-backed repository.
 *
 * This intentionally mirrors {@link StateRepository}: shared behavior in the
 * base class, storage specifics in the subclass.
 */
export abstract class ConfigRepository {
  /** Identifiers of every available deployment. */
  protected abstract readDeploymentIds(): Promise<string[]>;

  /** Raw (un-merged) deployment config, or null when no such deployment exists. */
  protected abstract readDeploymentConfig(id: string): Promise<DeploymentConfig | null>;

  /** Raw provider profile referenced by `providerProfile`, or null when absent. */
  protected abstract readProviderProfile(name: string): Promise<ProviderConfig | null>;

  /**
   * Reference that today's lifecycle endpoints accept for this deployment
   * (its `configPath`). Transitional — see {@link DeploymentSummary.configPath}.
   */
  protected abstract deploymentRef(id: string): string;

  async listDeployments(): Promise<DeploymentSummary[]> {
    const ids = await this.readDeploymentIds();
    const summaries: DeploymentSummary[] = [];
    for (const id of ids) {
      try {
        const raw = await this.readDeploymentConfig(id);
        if (!raw) continue;
        summaries.push(await this.buildSummary(id, raw));
      } catch {
        // A single malformed deployment must not break discovery of the rest.
        // getDeployment(id) surfaces the specific parse error on demand.
        continue;
      }
    }
    return summaries.sort((a, b) => a.id.localeCompare(b.id));
  }

  async getDeployment(id: string): Promise<DeploymentDescriptor | null> {
    const raw = await this.readDeploymentConfig(id);
    if (!raw) return null;

    const merged = await this.mergeProviderProfile(raw);
    const summary = this.summaryFrom(id, raw, merged);
    const steps = raw.steps ?? [];

    return {
      ...summary,
      providerProfile: typeof raw.providerProfile === "string" ? raw.providerProfile : null,
      resources: (raw.resources ?? []).map((resource) => ({
        kind: resource.kind,
        name: resource.name ?? null,
        hostname: resource.hostname,
        provider: resource.placement?.provider ?? merged.type ?? null,
      })),
      steps: steps.map(toStepSummary),
      inputs: inferInputs(steps),
      // Walk the whole effective deployment (resources, steps, and the merged
      // provider profile) so deployment-level *Env refs are included, not just
      // the provider's.
      requiredEnv: collectRequiredEnv({ ...raw, provider: merged }),
    };
  }

  // ── Lifecycle config loaders ────────────────────────────────────────────────
  // The broker's up/down/deploy path loads config through these accessors, closing
  // the formerly discovery-only seam: same storage source as discovery, so a
  // Postgres repo serves both. Each returns null when absent; the broker turns that
  // into a throw with a useful message.

  async getRawDeploymentConfig(ref: string): Promise<DeploymentConfig | null> {
    return this.readDeploymentConfig(deploymentIdFromRef(ref));
  }

  async getProviderProfile(name: string): Promise<ProviderConfig | null> {
    return this.readProviderProfile(name);
  }

  async getAppProfile<T = unknown>(group: string, name: string): Promise<T | null> {
    return (await this.readAppProfile(group, name)) as T | null;
  }

  async getConfigProfile<T = unknown>(group: string, name: string): Promise<T | null> {
    return (await this.readConfigProfile(group, name)) as T | null;
  }

  async getResourceProfile(name: string): Promise<TerraformResourceProfile | null> {
    return this.readResourceProfile(name);
  }

  /** App profile by group + name (e.g. windows/<profile>). Null when absent. */
  protected abstract readAppProfile(group: string, name: string): Promise<unknown | null>;
  /** Config profile by group + name. Null when absent. */
  protected abstract readConfigProfile(group: string, name: string): Promise<unknown | null>;
  /** Terraform resource profile by name. Null when absent. */
  protected abstract readResourceProfile(name: string): Promise<TerraformResourceProfile | null>;

  private async buildSummary(id: string, raw: DeploymentConfig): Promise<DeploymentSummary> {
    return this.summaryFrom(id, raw, await this.mergeProviderProfile(raw));
  }

  private summaryFrom(
    id: string,
    raw: DeploymentConfig,
    merged: ProviderConfig,
  ): DeploymentSummary {
    const resources = raw.resources ?? [];
    const steps = raw.steps ?? [];
    return {
      id,
      configPath: this.deploymentRef(id),
      name: raw.name,
      provider: merged.type ?? null,
      projectName: typeof merged.projectName === "string" ? merged.projectName : null,
      resourceKinds: [...new Set(resources.map((resource) => resource.kind))],
      resourceCount: resources.length,
      stepCount: steps.length,
      deployable: steps.length > 0,
    };
  }

  /** Apply the provider profile beneath the deployment's inline provider block. */
  private async mergeProviderProfile(raw: DeploymentConfig): Promise<ProviderConfig> {
    const base = raw.provider ?? ({} as ProviderConfig);
    if (typeof raw.providerProfile !== "string" || !raw.providerProfile) return base;
    const profile = await this.readProviderProfile(raw.providerProfile);
    if (!profile) return base;
    return { ...profile, ...base };
  }
}

/** Accept either a bare deployment id ("aws-gp-lab") or a legacy path ref. */
function deploymentIdFromRef(ref: string): string {
  const base = ref.split("/").pop() ?? ref;
  return base.replace(/\.ya?ml$/i, "");
}

function toStepSummary(step: DeploymentStepConfig): DeploymentStepSummary {
  const summary: DeploymentStepSummary = {
    name: step.name,
    action: step.action,
    targets: step.targets ?? [],
  };
  if (step.resourceAction !== undefined) summary.resourceAction = step.resourceAction;
  if (step.description !== undefined) summary.description = step.description;
  if (step.enabled !== undefined) summary.enabled = step.enabled;
  if (step.when) {
    summary.when = { param: step.when.param, enablesWhen: enablesValue(step.when.equals) };
  }
  return summary;
}

/**
 * Inputs the deploy form can set. Derived from step `when:` conditions — each
 * distinct `when.param` is a toggle that, when set to its `enablesWhen` value,
 * runs the steps it gates. (Step toggles are the only machine-discoverable
 * inputs today; declared inputs will extend this after the DB move.)
 */
function inferInputs(steps: DeploymentStepConfig[]): DeploymentInput[] {
  const byName = new Map<string, DeploymentInput>();
  for (const step of steps) {
    if (!step.when) continue;
    const enablesWhen = enablesValue(step.when.equals);
    const existing = byName.get(step.when.param);
    if (existing) {
      existing.affectsSteps.push(step.name);
      continue;
    }
    const type = typeof enablesWhen as DeploymentInput["type"];
    byName.set(step.when.param, {
      name: step.when.param,
      type,
      // Absent param means the gated step is skipped, so the safe default is the
      // value that does NOT enable it. Only inferable for booleans.
      ...(type === "boolean" ? { default: !enablesWhen } : {}),
      enablesWhen,
      affectsSteps: [step.name],
      source: "step-condition",
    });
  }
  return [...byName.values()];
}

function enablesValue(equals: string | number | boolean | null | undefined): boolean | string | number {
  // `when` without `equals` means "param is truthy" — mirrors shouldRunDeploymentStep.
  if (equals === undefined || equals === null) return true;
  return equals;
}

/** Recursively collect string values of any key ending in `Env` (the secret indirection). */
function collectRequiredEnv(root: unknown): string[] {
  const acc = new Set<string>();
  walkEnvRefs(root, acc);
  return [...acc].sort();
}

function walkEnvRefs(value: unknown, acc: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) walkEnvRefs(item, acc);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, val] of Object.entries(value)) {
      if (key.endsWith("Env") && typeof val === "string" && val.trim()) {
        acc.add(val.trim());
      } else {
        walkEnvRefs(val, acc);
      }
    }
  }
}
