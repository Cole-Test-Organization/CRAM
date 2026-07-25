import type { ResourceLifecycleStatus, ResourcePowerState } from "./common.js";

// Reconciliation answers two questions the broker could not previously tell apart
// when a resource looks live in state but is gone from the cloud:
//   1. are the provider credentials still usable at all, and
//   2. if they are, does the underlying machine still exist?
// A failed lookup under bad credentials must never be read as "the box is gone",
// so every provider probe reports which of the two it hit.

export type ProviderCredentialState =
  /** The provider answered an identity/authorization call. */
  | "ok"
  /** Credentials exist but the session/token has expired — re-login. */
  | "expired"
  /** No credentials are configured for this provider at all. */
  | "missing"
  /** Credentials are valid but lack permission for the probe. */
  | "denied"
  /** The check itself failed (CLI absent, network, unparseable output). */
  | "error"
  /** This provider adapter has no credential check. */
  | "unsupported";

export interface ProviderCredentialStatus {
  state: ProviderCredentialState;
  /** Who the credentials resolve to (AWS account/arn, GCP account, Proxmox endpoint). */
  identity?: string | null;
  /** The provider's own message when the check failed. */
  detail?: string | null;
  /** Operator-facing fix, e.g. `aws sso login --profile lab`. */
  remediation?: string | null;
}

export type ProviderResourcePresence =
  /** The provider still has this resource. */
  | "present"
  /** The provider answered authoritatively that this resource no longer exists. */
  | "missing"
  /** The probe could not decide (auth failure, unsupported id shape, transient error). */
  | "unknown";

export interface ProviderResourceExistence {
  presence: ProviderResourcePresence;
  powerState?: ResourcePowerState | null;
  detail?: string | null;
  /** True when the lookup failed on auth — the resource may well still be there. */
  credentialFailure?: boolean;
}

export type ReconciledResourceStatus =
  | "present"
  | "missing"
  | "credentials-invalid"
  | "unsupported"
  | "unknown";

export interface ProviderCredentialReport extends ProviderCredentialStatus {
  provider: string;
  /** What was actually checked, e.g. `aws:us-west-2:lab-sso`. One check per scope. */
  scope: string;
  /** Provider profiles resolving to this scope. */
  providerProfiles: string[];
  checkedAt: string;
}

export interface ReconciledResource {
  id: string;
  hostname: string;
  name: string | null;
  deploymentId: string;
  kind: string | null;
  provider: string | null;
  providerResourceId: string | null;
  /** Credential scope this resource was checked under; null when it could not be resolved. */
  credentialScope: string | null;
  status: ReconciledResourceStatus;
  /** Lifecycle status recorded before this run. */
  previousLifecycleStatus: ResourceLifecycleStatus;
  /** Lifecycle status after this run (unchanged unless `applied`). */
  lifecycleStatus: ResourceLifecycleStatus;
  previousPowerState: ResourcePowerState | null;
  powerState: ResourcePowerState | null;
  /** The record claims a live resource the provider no longer has. */
  stale: boolean;
  /** This run wrote the correction back to broker state. */
  applied: boolean;
  detail: string | null;
}

export interface ReconciliationSummary {
  checked: number;
  present: number;
  missing: number;
  stale: number;
  credentialsInvalid: number;
  unknown: number;
  unsupported: number;
  markedDestroyed: number;
}

export interface ReconciliationReport {
  checkedAt: string;
  /** True when stale records were written back as destroyed. */
  applied: boolean;
  credentials: ProviderCredentialReport[];
  resources: ReconciledResource[];
  summary: ReconciliationSummary;
}

export interface ReconcileOptions {
  /** Write stale records back as destroyed. Default false (dry run). */
  apply?: boolean;
  /** Also probe records already marked destroyed. Default false. */
  includeDestroyed?: boolean;
  /** Limit to one deployment slug. */
  deployment?: string | null;
}
