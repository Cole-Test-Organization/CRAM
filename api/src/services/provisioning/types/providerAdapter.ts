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

export interface ProviderPortForwardRequest {
  /** Remote TCP port on the resource to forward (e.g. 3389 for RDP). */
  remotePort: number;
  /** Local loopback port the forward must open and listen on. */
  localPort: number;
  /** Loopback host to bind locally; defaults to 127.0.0.1. */
  localHost?: string;
  /**
   * Invoked at most once if the forward exits or fails on its own — i.e. NOT in
   * response to close(). The string is a human-readable reason for logging.
   */
  onExit?: (reason: string) => void;
}

export interface ProviderPortForward {
  /** The local loopback port the forward is listening on (echoes the request). */
  readonly localPort: number;
  /** True once the forward has been torn down via close() or has exited on its own. */
  readonly closed: boolean;
  /** Tear down the forward. Idempotent; does not invoke the request's onExit. */
  close(): Promise<void>;
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

  /**
   * Open a TCP port-forward from the resource's `remotePort` to a local loopback
   * port chosen by the caller (`request.localPort`), returning a handle the caller
   * uses to await readiness (by connecting to the local port) and tear it down.
   * The provider owns the transport (e.g. AWS SSM port forwarding); the caller
   * owns the local proxy/port pool/TTL. Optional — providers that can't tunnel
   * (or don't need to) omit it, and callers get a clear "unsupported" error.
   */
  openPortForward?(
    context: ProviderGenericResourceContext,
    record: ResourceRecord,
    request: ProviderPortForwardRequest,
    log: LogFn,
  ): Promise<ProviderPortForward>;
}
