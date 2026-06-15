import type { ManagementAddressType } from "./common.js";
import type { ResourceValueReference } from "./resource.js";

export interface PanosBootstrapConfig {
  adminUsername?: string | null;
  adminPassword?: string | null;
  adminPasswordEnv?: string | null;
  initialAdminPassword?: string | null;
  initialAdminPasswordEnv?: string | null;
  apiPort?: number | null;
  sshPort?: number | null;
  tlsRejectUnauthorized?: boolean | null;
  readinessTimeoutSeconds?: number | null;
  generateVmAuthKey?: boolean | null;
  vmAuthKeyLifetimeHours?: number | null;
}

export interface PanoramaOnboardingConfig {
  deviceGroup?: string | null;
  template?: string | null;
  templateStack?: string | null;
  firewalls?: string[] | null;
  vsys?: string | null;
  commit?: boolean | null;
}

export interface PanoramaConfigAddOnConfig {
  name?: string | null;
  file: string;
  commit?: boolean | null;
  push?: PanoramaConfigPushConfig | null;
}

export interface PanwVmseriesConfigProfileConfig {
  name: string;
  description?: string | null;
  configAddOns?: PanoramaConfigAddOnConfig[] | null;
}

export interface PanoramaConfigPushConfig {
  templateStack?: boolean | string | null;
  deviceGroup?: boolean | string | null;
  firewalls?: string[] | null;
  vsys?: string | null;
  timeoutSeconds?: number | null;
}

export interface PanwVmseriesConfig {
  kind?: "panw-vmseries";
  name?: string | null;
  hostname: string;
  vm: {
    cpuCores: number;
    memoryMb: number;
    cpuType?: string;
    started?: boolean;
  };
  management: {
    type: ManagementAddressType;
    ipAddress?: string | null;
    netmask?: string | null;
    defaultGateway?: string | null;
    dnsPrimary?: string | null;
    dnsSecondary?: string | null;
  };
  interfaces?: NetworkInterfaceConfig[];
  license: {
    authCode?: string | null;
    authCodeEnv?: string | null;
    // CSP Licensing API Key (Assets -> Licensing API on the support portal),
    // required for auto-mode license deactivation on destroy. Optional: when
    // absent, delicense-on-destroy is skipped (best-effort).
    deactivationApiKey?: string | null;
    deactivationApiKeyEnv?: string | null;
  };
  managementServer:
    | {
        mode: "panorama";
        panoramaServer: string | ResourceValueReference;
        panoramaServer2?: string | ResourceValueReference | null;
        vmAuthKey?: string | ResourceValueReference | null;
        vmAuthKeyEnv?: string | null;
        templateStack?: string | null;
        deviceGroup?: string | null;
      }
    | {
        mode: "scm";
        folder?: string | null;
      }
    | {
        mode: "none";
      };
  deviceCertificate?: {
    pinId?: string | null;
    pinValue?: string | null;
    pinIdEnv?: string | null;
    pinValueEnv?: string | null;
  };
  bootstrap?: PanosBootstrapConfig;
  configProfiles?: unknown;
  configAddOns?: PanoramaConfigAddOnConfig[] | null;
  pluginCommands?: string[];
  destroy?: {
    allowWithoutDelicense?: boolean;
  };
}

export interface NetworkInterfaceConfig {
  name: string;
  bridge: string;
  model?: string;
  vlanId?: number | null;
  macAddress?: string | null;
  firewall?: boolean;
}

export interface ProxmoxFirewallRuntimeConfig {
  endpointEnv: string;
  apiTokenEnv: string;
  insecure?: boolean;
  sshUsername?: string;
  targetNode: string;
  templateVmId: number;
  templateNode?: string | null;
  vmId?: number | null;
  vmDatastoreId?: string | null;
  isoDatastoreId: string;
}

export interface FirewallConfig extends PanwVmseriesConfig {
  interfaces: NetworkInterfaceConfig[];
  proxmox: ProxmoxFirewallRuntimeConfig;
}

export interface BootstrapResult {
  bootstrapDir: string;
  isoPath: string;
  initCfgPath: string;
}
