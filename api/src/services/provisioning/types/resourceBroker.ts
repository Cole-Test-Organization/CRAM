import type { ResourcePowerState } from "./common.js";
import type { JobRecord, ResourceRecord } from "./state.js";
import type { DeploymentConfig } from "./deployment.js";
import type { ProviderConfig } from "./provider.js";
import type { ResourceConfig } from "./resource.js";
import type { TerraformResourceProfile } from "./terraformResourceProfile.js";

export interface ResourceBrokerRunOptions {
  skipActiveJobCheck?: boolean;
  patchUnchangedPowerState?: boolean;
  params?: Record<string, unknown>;
  /**
   * Skip the up-front reference preflight. Set on the per-resource up()/runAction()
   * calls a multi-step deploy fans out, since deploy() already validated the whole
   * deployment once before the first step. Teardown paths never validate.
   */
  skipReferenceCheck?: boolean;
}

export type ResourcePowerAction = "start" | "stop";

export interface ResourcePowerSelector {
  deploymentId?: string;
  configPath?: string;
  targets?: string[];
  includeKinds?: string[];
  excludeKinds?: string[];
}

export interface ResourcePowerActionResult {
  action: ResourcePowerAction;
  resource: ResourceRecord;
  status: "succeeded" | "skipped" | "failed";
  powerState?: ResourcePowerState | null;
  message?: string;
}

export interface ResourcePowerRequestBody {
  deploymentId?: string;
  configPath?: string;
  targets?: string[];
  includeKinds?: string[];
  excludeKinds?: string[];
}

export interface ResourceConfigLoader {
  loadProviderProfile(profileName: string): Promise<ProviderConfig>;
  loadAppProfile<TProfile = unknown>(group: string, profileName: string): Promise<TProfile>;
  loadConfigProfile<TProfile = unknown>(group: string, profileName: string): Promise<TProfile>;
  loadTerraformResourceProfile(
    deployment: DeploymentConfig,
    resource: ResourceConfig,
  ): Promise<TerraformResourceProfile>;
  resolveProjectPath(filePath: string): string;
}

export type ResourceJobRunner = (log: (line: string) => void) => Promise<void>;
export type ResourceJobAction = JobRecord["action"];
