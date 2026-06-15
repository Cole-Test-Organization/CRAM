import type { ProviderType } from "./common.js";

/**
 * Storage-agnostic discovery contract.
 *
 * These shapes are what the frontend codes against. They are deliberately
 * decoupled from where deployments are stored: today a `FileConfigRepository`
 * builds them from `database/**` YAML, later a SQL-backed repository builds the
 * same shapes from rows. Endpoints and frontend should not change when that
 * move happens.
 */

/**
 * A deployment-time input the operator can set. Today the only discoverable
 * inputs are step-toggles: a `when:` clause that gates whether a step runs
 * (`source: "step-condition"`). When deployments move to the database, declared
 * inputs will populate the same shape with `source: "declared"`.
 */
export interface DeploymentInput {
  name: string;
  type: "boolean" | "string" | "number";
  default?: boolean | string | number;
  /** Value that activates the gated steps (param === enablesWhen runs them). */
  enablesWhen: boolean | string | number;
  /** Names of the steps this input gates. */
  affectsSteps: string[];
  source: "step-condition";
}

export interface DeploymentResourceSummary {
  kind: string;
  name: string | null;
  hostname: string;
  provider: ProviderType | null;
}

export interface DeploymentStepSummary {
  name: string;
  action: string;
  resourceAction?: string;
  targets: string[];
  description?: string;
  enabled?: boolean;
  when?: { param: string; enablesWhen: boolean | string | number };
}

export interface DeploymentSummary {
  /** Durable identifier (filename stem today, primary key after the DB move). */
  id: string;
  /**
   * Reference accepted by today's lifecycle endpoints (`configPath`). Transitional:
   * it disappears when deployments move to the database and endpoints accept `id`.
   */
  configPath: string;
  name: string;
  provider: ProviderType | null;
  projectName: string | null;
  resourceKinds: string[];
  resourceCount: number;
  stepCount: number;
  /** True when the deployment has steps (drive via deploy); false = per-resource up/down. */
  deployable: boolean;
}

export interface DeploymentDescriptor extends DeploymentSummary {
  providerProfile: string | null;
  resources: DeploymentResourceSummary[];
  steps: DeploymentStepSummary[];
  inputs: DeploymentInput[];
  /** Sorted, de-duplicated set of environment variables the deployment references. */
  requiredEnv: string[];
}
