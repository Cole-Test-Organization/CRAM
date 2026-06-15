import type { ResourceConfig } from "./resource.js";
import type { ResourceConfigLoader } from "./resourceBroker.js";

export interface WindowsApplicationVerify {
  command?: string;
}

export interface WindowsApplicationConfig {
  id: string;
  name?: string;
  method: "chocolatey" | "exe" | "msi" | "powershell";
  package?: string;
  url?: string;
  sourcePath?: string;
  command?: string;
  args?: string[];
  allowedExitCodes?: number[];
  environment?: Record<string, string>;
  verify?: WindowsApplicationVerify;
}

export interface WindowsAppProfile {
  name: string;
  description?: string;
  apps: WindowsApplicationConfig[];
}

export type WindowsAppProfileLoader = ResourceConfigLoader;

export type WindowsEndpointResource = ResourceConfig & {
  appProfiles?: unknown;
  applications?: unknown;
};
