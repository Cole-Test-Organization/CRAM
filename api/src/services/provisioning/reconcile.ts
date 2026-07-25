import { getProviderAdapter } from "./providers/index.js";
import type { NamedProviderProfile } from "./config/index.js";
import type {
  ProviderCredentialReport,
  ProviderCredentialStatus,
  ReconciledResource,
  ReconciliationReport,
  ReconcileOptions,
  ResourceRecord,
} from "./types/index.js";
import type { LogFn } from "./types/logging.js";
import type {
  ProviderAdapter,
  ProviderGenericResourceContext,
} from "./types/providerAdapter.js";
import { errorMessage, trimCliMessage } from "./providers/credentials.js";
import { nowIso } from "./utils/index.js";

// Reconciliation compares what broker state claims against what each cloud actually has.
// The whole point is telling two failure modes apart: credentials that have expired (very
// common with SSO/OAuth logins, and NOT evidence about the infrastructure) versus working
// credentials that report a resource is gone (a genuinely stale record). A resource is
// only ever marked destroyed under credentials that were verified good in the same run.

export interface ReconcileContext {
  provider: ProviderAdapter;
  context: ProviderGenericResourceContext;
}

export type AdapterResolver = (providerType: string) => ProviderAdapter;

export interface ReconcileDependencies {
  listResources(): Promise<ResourceRecord[]>;
  listProviderProfiles(): Promise<NamedProviderProfile[]>;
  /** Null when the record's deployment config no longer resolves. */
  resolveContext(record: ResourceRecord): Promise<ReconcileContext | null>;
  patchResource(id: string, patch: Partial<ResourceRecord>): Promise<ResourceRecord>;
  /** Defaults to the real provider registry; overridden in tests. */
  getAdapter?: AdapterResolver;
}

const NOOP_LOG: LogFn = () => undefined;

/**
 * Check every configured provider profile's credentials, one call per distinct credential
 * scope (account + region + profile) — several profiles routinely share one login.
 */
export async function checkProviderCredentials(
  profiles: NamedProviderProfile[],
  log: LogFn = NOOP_LOG,
  getAdapter: AdapterResolver = getProviderAdapter,
): Promise<ProviderCredentialReport[]> {
  const cache = new CredentialCache(log, getAdapter);
  for (const { name, provider } of profiles) {
    await cache.report(provider, name);
  }
  return cache.reports();
}

export async function reconcileResources(
  deps: ReconcileDependencies,
  options: ReconcileOptions = {},
  log: LogFn = NOOP_LOG,
): Promise<ReconciliationReport> {
  const apply = options.apply === true;
  const cache = new CredentialCache(log, deps.getAdapter ?? getProviderAdapter);

  // Seed the cache from the catalog so the report covers every configured cloud, even
  // ones with no resources — an expired login is worth surfacing before a deploy.
  for (const { name, provider } of await deps.listProviderProfiles()) {
    await cache.report(provider, name);
  }

  const records = (await deps.listResources()).filter((record) => {
    if (!options.includeDestroyed && record.lifecycleStatus === "destroyed") return false;
    if (options.deployment && record.deploymentId !== options.deployment) return false;
    return true;
  });

  const resources: ReconciledResource[] = [];
  for (const record of records) {
    resources.push(await reconcileOne(record, deps, cache, apply, log));
  }

  return {
    checkedAt: nowIso(),
    applied: apply,
    credentials: cache.reports(),
    resources,
    summary: summarize(resources),
  };
}

async function reconcileOne(
  record: ResourceRecord,
  deps: ReconcileDependencies,
  cache: CredentialCache,
  apply: boolean,
  log: LogFn,
): Promise<ReconciledResource> {
  const base = baseResult(record);

  let resolved: ReconcileContext | null;
  try {
    resolved = await deps.resolveContext(record);
  } catch (error) {
    return { ...base, status: "unknown", detail: trimCliMessage(errorMessage(error)) };
  }
  if (!resolved) {
    return { ...base, status: "unknown", detail: "deployment config no longer resolves for this record" };
  }

  const { provider, context } = resolved;
  const credentials = await cache.report(context.deployment.provider);
  const withScope = { ...base, credentialScope: credentials.scope };

  if (credentials.state === "unsupported") {
    return {
      ...withScope,
      status: "unsupported",
      detail: `provider ${provider.type} has no credential check`,
    };
  }
  if (credentials.state !== "ok") {
    return {
      ...withScope,
      status: "credentials-invalid",
      detail: credentials.detail ?? `provider credentials are ${credentials.state}`,
    };
  }
  if (!provider.describeResource) {
    return {
      ...withScope,
      status: "unsupported",
      detail: `provider ${provider.type} cannot verify resource existence`,
    };
  }

  const existence = await provider.describeResource(context, record, log);
  // A lookup that failed on auth says nothing about the resource, even though the
  // scope-level check passed a moment ago (per-resource region/role can still deny).
  if (existence.credentialFailure) {
    return { ...withScope, status: "credentials-invalid", detail: existence.detail ?? null };
  }

  if (existence.presence === "present") {
    const powerState = existence.powerState ?? record.powerState ?? null;
    const changed = powerState !== (record.powerState ?? null);
    if (apply && changed) {
      await deps.patchResource(record.id, { powerState, powerStateCheckedAt: nowIso() });
    }
    return {
      ...withScope,
      status: "present",
      powerState,
      applied: apply && changed,
      detail: existence.detail ?? null,
    };
  }

  if (existence.presence === "missing") {
    const stale = record.lifecycleStatus !== "destroyed";
    if (apply && stale) {
      await deps.patchResource(record.id, {
        lifecycleStatus: "destroyed",
        powerState: existence.powerState ?? "terminated",
        powerStateCheckedAt: nowIso(),
      });
      log(`Marked ${record.hostname} destroyed: ${existence.detail ?? "the provider no longer has it"}`);
    }
    return {
      ...withScope,
      status: "missing",
      stale,
      applied: apply && stale,
      lifecycleStatus: apply && stale ? "destroyed" : record.lifecycleStatus,
      powerState: existence.powerState ?? (apply && stale ? "terminated" : record.powerState ?? null),
      detail: existence.detail ?? null,
    };
  }

  return { ...withScope, status: "unknown", detail: existence.detail ?? null };
}

function baseResult(record: ResourceRecord): ReconciledResource {
  return {
    id: record.id,
    hostname: record.hostname,
    name: record.name ?? null,
    deploymentId: record.deploymentId,
    kind: record.kind ?? null,
    provider: record.provider ?? null,
    providerResourceId: record.providerResourceId ?? null,
    credentialScope: null,
    status: "unknown",
    previousLifecycleStatus: record.lifecycleStatus,
    lifecycleStatus: record.lifecycleStatus,
    previousPowerState: record.powerState ?? null,
    powerState: record.powerState ?? null,
    stale: false,
    applied: false,
    detail: null,
  };
}

function summarize(resources: ReconciledResource[]): ReconciliationReport["summary"] {
  const count = (predicate: (r: ReconciledResource) => boolean) => resources.filter(predicate).length;
  return {
    checked: resources.length,
    present: count((r) => r.status === "present"),
    missing: count((r) => r.status === "missing"),
    stale: count((r) => r.stale),
    credentialsInvalid: count((r) => r.status === "credentials-invalid"),
    unknown: count((r) => r.status === "unknown"),
    unsupported: count((r) => r.status === "unsupported"),
    markedDestroyed: count((r) => r.applied && r.status === "missing"),
  };
}

/** One credential probe per scope per run, shared by the catalog sweep and every resource. */
class CredentialCache {
  private readonly byScope = new Map<string, ProviderCredentialReport>();

  constructor(
    private readonly log: LogFn,
    private readonly getAdapter: AdapterResolver,
  ) {}

  async report(
    providerConfig: { type: string; [key: string]: unknown },
    profileName?: string,
  ): Promise<ProviderCredentialReport> {
    let adapter: ProviderAdapter;
    try {
      adapter = this.getAdapter(providerConfig.type);
    } catch (error) {
      return this.remember(
        {
          provider: providerConfig.type,
          scope: `${providerConfig.type}:unregistered`,
          state: "error",
          detail: trimCliMessage(errorMessage(error)),
          checkedAt: nowIso(),
          providerProfiles: [],
        },
        profileName,
      );
    }

    const scope = adapter.credentialScope?.(providerConfig) ?? adapter.type;
    const cached = this.byScope.get(scope);
    if (cached) {
      if (profileName && !cached.providerProfiles.includes(profileName)) {
        cached.providerProfiles.push(profileName);
      }
      return cached;
    }

    const status = await this.probe(adapter, providerConfig);
    return this.remember(
      { provider: adapter.type, scope, checkedAt: nowIso(), providerProfiles: [], ...status },
      profileName,
    );
  }

  reports(): ProviderCredentialReport[] {
    return [...this.byScope.values()].sort((left, right) => left.scope.localeCompare(right.scope));
  }

  private async probe(
    adapter: ProviderAdapter,
    providerConfig: { type: string; [key: string]: unknown },
  ): Promise<ProviderCredentialStatus> {
    if (!adapter.checkCredentials) return { state: "unsupported" };
    try {
      return await adapter.checkCredentials(providerConfig, this.log);
    } catch (error) {
      // checkCredentials is contracted to resolve; a throw is a bug in the adapter, not
      // a verdict on the credentials — never let it read as "the machines are gone".
      return { state: "error", detail: trimCliMessage(errorMessage(error)) };
    }
  }

  private remember(
    report: ProviderCredentialReport,
    profileName?: string,
  ): ProviderCredentialReport {
    if (profileName) report.providerProfiles.push(profileName);
    this.byScope.set(report.scope, report);
    return report;
  }
}
