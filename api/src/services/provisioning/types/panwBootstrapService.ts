import type { PanoramaConfigPushConfig } from "./panw.js";

export interface PanoramaBootstrapResult {
  managementAddress: string;
  vmAuthKey?: string | null;
  vmAuthKeyExpiresAt?: string | null;
}

export interface FirewallVerificationResult {
  managementAddress: string;
  connectedDeviceCount: number;
}

export interface PanoramaOnboardingResult {
  managementAddress: string;
  connectedDeviceCount: number;
  deviceGroup: string;
  template: string;
  templateStack: string;
  firewallSerials: string[];
}

export interface PanoramaConfigAddOnResult {
  managementAddress: string;
  appliedAddOns: string[];
  pushedTemplateStack?: string | null;
  pushedDeviceGroup?: string | null;
  firewallSerials: string[];
}

export interface PanoramaConfigAddOnInput {
  name: string;
  file: string;
  content: string;
  commit?: boolean | null;
  push?: PanoramaConfigPushConfig | null;
}

export interface FirewallConfigAddOnInput {
  name: string;
  file: string;
  content: string;
  commit?: boolean | null;
}

export interface FirewallConfigAddOnResult {
  managementAddress: string;
  appliedAddOns: string[];
}

export interface FirewallBootstrapResult {
  managementAddress: string;
  vmLicense?: string | null;
  serial?: string | null;
}

export interface FirewallDeactivationResult {
  deactivated: boolean;
  alreadyUnlicensed?: boolean;
  serial?: string | null;
  reason?: string;
}

export interface ResolvedBootstrapSettings {
  adminUsername: string;
  adminPassword: string;
  initialAdminPassword: string | null;
  sshPrivateKeyPath: string | null;
  sshAgentSocket: string | null;
  apiPort: number;
  sshPort: number;
  tlsRejectUnauthorized: boolean;
  readinessTimeoutMs: number;
  generateVmAuthKey: boolean;
  vmAuthKeyLifetimeHours: number;
}
