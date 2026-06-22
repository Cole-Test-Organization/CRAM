import type {
  DeploymentInputConfig,
  DeploymentStepConfig,
  TerraformResourceProfile,
} from "../../types/index.js";

/**
 * Authoring types for the code-defined config modules. These mirror the RAW shape
 * an author writes (what the YAML files used to hold), not the resolved runtime
 * shape: e.g. a deployment's `provider.type` is optional here because it's inherited
 * from `providerProfile` when the broker loads the deployment.
 *
 * Each module file declares `satisfies <…>Module` for compile-time checking; the Zod
 * schemas in ../schemas.ts are the runtime gate the seed + catalog test apply.
 */

/** A reusable cloud/provider record (provider-profiles/<name>.ts). */
export interface ProviderProfileModule {
  name: string;
  type: string;
  [key: string]: unknown;
}

/** A Terraform resource-profile mapping (resource-profiles/<name>.ts). */
export type ResourceProfileModule = TerraformResourceProfile;

/** A resource as authored inside a deployment (placement filled/validated later). */
export interface ResourceModule {
  kind: string;
  name?: string | null;
  hostname: string;
  terraformProfile?: string | null;
  placement?: Record<string, unknown>;
  [key: string]: unknown;
}

/** A deployment blueprint (deployments/<name>.ts). */
export interface DeploymentModule {
  name: string;
  providerProfile?: string | null;
  provider?: { type?: string; [key: string]: unknown };
  resources: ResourceModule[];
  inputs?: DeploymentInputConfig[];
  steps?: DeploymentStepConfig[];
  templateName?: string | null;
  displayName?: string | null;
}

/** An app-profile (app-profiles/<group>/<name>.ts); per-group shape validated by Zod. */
export interface AppProfileModule {
  name: string;
  [key: string]: unknown;
}

/** A config-profile (config-profiles/<group>/<name>.ts); per-group shape validated by Zod. */
export interface ConfigProfileModule {
  name: string;
  [key: string]: unknown;
}

/** A grouped profile entry as collected in the registry. */
export interface GroupedProfile<T> {
  group: string;
  profile: T;
}
