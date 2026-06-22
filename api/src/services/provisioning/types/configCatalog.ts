import type { ProviderType } from "./common.js";

/**
 * Storage-agnostic discovery contract.
 *
 * These shapes are what the frontend codes against. They are deliberately
 * decoupled from where deployments are stored. The API runtime builds them from
 * Postgres rows; the legacy file repository can build the same shapes from
 * `database/**` YAML for compatibility.
 */

/**
 * A deployment-time input the operator can set. Today the only discoverable
 * inputs can be declared by deployment config, or inferred as step-toggles from
 * a `when:` clause that gates whether a step runs (`source: "step-condition"`).
 */
export interface DeploymentInputOption {
  label: string;
  value: boolean | string | number;
}

export interface DeploymentInput {
  name: string;
  label?: string;
  description?: string;
  type: "boolean" | "string" | "number";
  default?: boolean | string | number;
  options?: DeploymentInputOption[];
  /** Value that activates the gated steps (param === enablesWhen runs them). */
  enablesWhen?: boolean | string | number;
  /** Names of the steps this input gates. */
  affectsSteps: string[];
  source: "declared" | "step-condition";
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
  /** Durable deployment slug. */
  id: string;
  /**
   * Reference accepted by lifecycle endpoints. In the API runtime this is the
   * same slug as `id`; legacy file-backed callers may still see a YAML path.
   */
  configPath: string;
  name: string;
  provider: ProviderType | null;
  projectName: string | null;
  resourceKinds: string[];
  resourceCount: number;
  stepCount: number;
  /** True when the deployment can be torn down as a whole (has steps, or has any resource to down). */
  deployable: boolean;
  /** Slug of the template this was cloned from; null when this row IS a catalog template. */
  templateName: string | null;
  /** Operator-facing label. For a template this is the slug; for an instance, what the user typed. */
  displayName: string | null;
  /** Convenience: true when templateName is null (a launchable blueprint, not a deployed instance). */
  isTemplate: boolean;
}

export interface DeploymentDescriptor extends DeploymentSummary {
  providerProfile: string | null;
  resources: DeploymentResourceSummary[];
  steps: DeploymentStepSummary[];
  inputs: DeploymentInput[];
  /** Sorted, de-duplicated set of environment variables the deployment references. */
  requiredEnv: string[];
}
