import type { ManagementAddressType, ResourceKind } from "./common.js";
import type {
  PanoramaConfigAddOnConfig,
  PanoramaOnboardingConfig,
  PanosBootstrapConfig,
  PanwVmseriesConfig,
} from "./panw.js";
import type { ResourcePlacementConfig } from "./provider.js";

export interface ResourceValueReference {
  fromResource: string;
  output?: string;
  state?: string;
}

export interface BaseResourceConfig {
  kind: ResourceKind;
  name?: string | null;
  hostname: string;
  terraformProfile?: string | null;
  placement: ResourcePlacementConfig;
  [key: string]: unknown;
}

export interface VmSizingConfig {
  cpuCores?: number | null;
  memoryMb?: number | null;
  cpuType?: string | null;
  started?: boolean;
  instanceType?: string | null;
}

export interface PanwVmseriesResourceConfig extends PanwVmseriesConfig {
  kind: "panw-vmseries";
  terraformProfile?: string | null;
  placement: ResourcePlacementConfig;
}

export interface PanoramaResourceConfig extends BaseResourceConfig {
  kind: "panorama";
  name?: string | null;
  hostname: string;
  terraformProfile?: string | null;
  vm?: VmSizingConfig;
  management?: {
    type: ManagementAddressType;
    dnsPrimary?: string | null;
    dnsSecondary?: string | null;
  };
  license: {
    authCode?: string | null;
    authCodeEnv?: string | null;
    serial?: string | null;
    serialEnv?: string | null;
  };
  bootstrap?: PanosBootstrapConfig;
  onboarding?: PanoramaOnboardingConfig;
  configAddOns?: PanoramaConfigAddOnConfig[] | null;
  placement: ResourcePlacementConfig;
}

export type ResourceConfig = PanwVmseriesResourceConfig | PanoramaResourceConfig | BaseResourceConfig;
