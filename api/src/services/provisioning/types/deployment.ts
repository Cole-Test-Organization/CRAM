import type { ProviderConfig } from "./provider.js";
import type { ResourceConfig } from "./resource.js";

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
  steps?: DeploymentStepConfig[];
}
