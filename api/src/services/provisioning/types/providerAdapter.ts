import type {
  DeploymentConfig,
  ResourcePowerState,
  ResourceRecord,
  ResourceConfig,
} from "./index.js";
import type { StateRepository } from "../state/index.js";
import type { LogFn } from "./logging.js";
import type { ResourceConfigLoader } from "./resourceBroker.js";

export interface ProviderResourceContext<TResource extends ResourceConfig = ResourceConfig> {
  configPath: string;
  configLoader: ResourceConfigLoader;
  stateRepository: StateRepository;
  deployment: DeploymentConfig;
  resource: TResource;
}

export type ProviderGenericResourceContext = ProviderResourceContext<ResourceConfig>;

export interface ProviderApplyResult {
  vmId?: number | null;
  bootstrapIsoFileId?: string | null;
  terraformStatePath?: string | null;
  providerResourceId?: string | null;
  outputs?: Record<string, unknown> | null;
}

export interface ProviderPowerControlResult {
  powerState: ResourcePowerState;
}

export interface ProviderPowerShellCommandOptions {
  timeoutSeconds?: number;
}

export interface ProviderWindowsBootstrapWaitOptions {
  timeoutSeconds?: number;
}

export interface ProviderLocalArtifactRequest {
  id: string;
  sourcePath: string;
  fileName?: string;
}

export interface ProviderStagedLocalArtifact {
  id: string;
  sourcePath: string;
  url: string;
}

export interface ProviderStagedLocalArtifactSet {
  artifacts: ProviderStagedLocalArtifact[];
  cleanup(log: LogFn): Promise<void>;
}

export interface ProviderAdapter {
  readonly type: string;
  readonly requiresBootstrapIso?: boolean;

  supportsPowerControl?(
    context: ProviderGenericResourceContext,
    record: ResourceRecord,
  ): boolean;

  getResourcePowerState?(
    context: ProviderGenericResourceContext,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<ResourcePowerState>;

  startResource?(
    context: ProviderGenericResourceContext,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<ProviderPowerControlResult>;

  stopResource?(
    context: ProviderGenericResourceContext,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<ProviderPowerControlResult>;

  runPowerShellCommand?(
    context: ProviderGenericResourceContext,
    record: ResourceRecord,
    commands: string[],
    description: string,
    log: LogFn,
    options?: ProviderPowerShellCommandOptions,
  ): Promise<void>;

  capturePowerShellCommand?(
    context: ProviderGenericResourceContext,
    record: ResourceRecord,
    commands: string[],
    description: string,
    log: LogFn,
    options?: ProviderPowerShellCommandOptions,
  ): Promise<string>;

  waitForWindowsBootstrap?(
    context: ProviderGenericResourceContext,
    record: ResourceRecord,
    log: LogFn,
    options?: ProviderWindowsBootstrapWaitOptions,
  ): Promise<void>;

  stageLocalArtifacts?(
    context: ProviderGenericResourceContext,
    artifacts: ProviderLocalArtifactRequest[],
    log: LogFn,
  ): Promise<ProviderStagedLocalArtifactSet>;
}
