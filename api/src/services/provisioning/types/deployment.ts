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
  /**
   * App-profile group this input's value(s) select from (e.g. "windows", "linux").
   * Lets the catalog cross-reference check validate that every option value names
   * a real app profile. Purely advisory metadata — the broker ignores it.
   */
  appProfileGroup?: string;
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
  /** Slug of the template this row was cloned from; null/undefined when this row IS a template. */
  templateName?: string | null;
  /** Human label the operator typed for an instance (the `name` slug is sanitized/unique). */
  displayName?: string | null;
}
