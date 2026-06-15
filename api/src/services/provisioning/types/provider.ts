import type { ProviderType } from "./common.js";
import type { NetworkInterfaceConfig } from "./panw.js";

export interface ProviderConfig {
  type: ProviderType;
  [key: string]: unknown;
}

export interface ProxmoxProviderConfig extends ProviderConfig {
  type: "proxmox";
  endpointEnv: string;
  apiTokenEnv: string;
  insecure?: boolean;
  sshUsername?: string;
  defaultTargetNode?: string | null;
  defaultTemplateNode?: string | null;
  defaultVmDatastoreId?: string | null;
  defaultIsoDatastoreId?: string | null;
}

export type NetworkPlacementMode = "managed" | "existing";

export interface ResourceNetworkInterfacePlacementConfig {
  subnetId?: unknown;
  subnetCidr?: unknown;
  [key: string]: unknown;
}

export interface ResourceNetworkNextHopConfig {
  type?: string | null;
  id?: unknown;
  networkInterfaceId?: unknown;
  privateIpAddress?: unknown;
  [key: string]: unknown;
}

export interface ResourceNetworkPlacementConfig {
  mode?: NetworkPlacementMode | null;
  vpcId?: unknown;
  subnetId?: unknown;
  subnetCidr?: unknown;
  routeTableId?: unknown;
  destinationCidr?: string | null;
  interfaces?: Record<string, ResourceNetworkInterfacePlacementConfig> | null;
  nextHop?: ResourceNetworkNextHopConfig | null;
  [key: string]: unknown;
}

export interface ResourcePlacementConfig {
  provider?: ProviderType | null;
  network?: ResourceNetworkPlacementConfig | null;
  [key: string]: unknown;
}

export interface ProxmoxVmseriesPlacement extends ResourcePlacementConfig {
  provider?: "proxmox";
  targetNode?: string | null;
  templateVmId: number;
  templateNode?: string | null;
  vmId?: number | null;
  vmDatastoreId?: string | null;
  isoDatastoreId: string;
  interfaces?: NetworkInterfaceConfig[];
}
