import type { ProviderConfig } from "./provider.js";
import type { ResourceConfig } from "./resource.js";

export interface DeploymentInputConfigOption {
  label?: string;
  value: string | number | boolean;
}

export interface DeploymentInputConfig {
  name: string;
  label?: string;
  description?: string;
  type: "boolean" | "string" | "number";
  default?: string | number | boolean;
  options?: DeploymentInputConfigOption[];
}

export interface DeploymentStepConfig {
  name: string;
  action: string;
  resourceAction?: string;
  targets?: string[];
  enabled?: boolean;
  when?: {
    param: string;
    equals?: string | number | boolean | null;
  };
  params?: Record<string, unknown>;
  description?: string;
}

export interface DeploymentConfig {
  name: string;
  providerProfile?: string | null;
  provider: ProviderConfig;
  resources: ResourceConfig[];
  inputs?: DeploymentInputConfig[];
  steps?: DeploymentStepConfig[];
}
