import type {
  DeploymentConfig,
  ResourceConfig,
  ResourceRecord,
} from "../types/index.js";
import type { LogFn } from "../types/logging.js";
import type {
  ProviderAdapter,
  ProviderResourceContext,
} from "../types/providerAdapter.js";
import type { TerraformRunner } from "./terraformRunner.js";

export interface ResourceAdapterContext<TResource extends ResourceConfig = ResourceConfig>
  extends ProviderResourceContext<TResource> {
  provider: ProviderAdapter;
  terraform: TerraformRunner;
  params?: Record<string, unknown>;
}

export interface ResourceActionRequest {
  action: string;
  targets: string[];
  params?: Record<string, unknown>;
  stepName?: string;
  description?: string;
}

export interface ResourceUpResult {
  resourcePatch?: Partial<ResourceRecord>;
}

export interface ResourceAdapter<TResource extends ResourceConfig = ResourceConfig> {
  readonly kind: string;

  prepareDeployment?(
    deployment: DeploymentConfig,
    configLoader: ResourceAdapterContext<TResource>["configLoader"],
    configRef: string,
    params?: Record<string, unknown>,
  ): Promise<DeploymentConfig>;

  initialState?(
    deployment: DeploymentConfig,
    resource: TResource,
    provider: ProviderAdapter,
    configPath: string,
  ): Partial<ResourceRecord>;

  up(
    context: ResourceAdapterContext<TResource>,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<ResourceUpResult>;

  down(
    context: ResourceAdapterContext<TResource>,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<void>;

  runAction?(
    context: ResourceAdapterContext<TResource>,
    record: ResourceRecord,
    request: ResourceActionRequest,
    log: LogFn,
  ): Promise<Partial<ResourceRecord>>;
}

export class ResourceAdapterRegistry {
  private readonly adapters = new Map<string, ResourceAdapter>();

  constructor(
    adapters: ResourceAdapter[],
    private readonly fallback: ResourceAdapter,
  ) {
    for (const adapter of adapters) {
      this.adapters.set(adapter.kind, adapter);
    }
  }

  resolve(kind: string): ResourceAdapter {
    return this.adapters.get(kind) ?? this.fallback;
  }

  async prepareDeployment(
    deployment: DeploymentConfig,
    configLoader: ResourceAdapterContext["configLoader"],
    configRef: string,
    params?: Record<string, unknown>,
  ): Promise<DeploymentConfig> {
    let prepared = deployment;
    const preparedAdapters = new Set<ResourceAdapter>();

    for (const resource of deployment.resources) {
      const adapter = this.resolve(resource.kind);
      if (!adapter.prepareDeployment || preparedAdapters.has(adapter)) continue;
      preparedAdapters.add(adapter);
      prepared = await adapter.prepareDeployment(prepared, configLoader, configRef, params);
    }

    return prepared;
  }
}
