export type ManagementMode = "panorama" | "scm" | "none";
export type ManagementAddressType = "static" | "dhcp-client";
export type ProviderType = string;
export type ResourceKind = string;

export type ResourceLifecycleStatus =
  | "idle"
  | "bootstrap_rendered"
  | "iso_built"
  | "terraform_applying"
  | "vm_created"
  | "panos_bootstrapping"
  | "panos_verifying"
  | "panos_onboarding"
  | "panos_configuring"
  | "ready"
  | "destroy_requested"
  | "terraform_destroying"
  | "destroyed"
  | "failed";

export type ResourcePowerState =
  | "unknown"
  | "pending"
  | "running"
  | "stopping"
  | "stopped"
  | "terminated";
