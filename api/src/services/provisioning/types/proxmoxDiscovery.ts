export interface ProxmoxConnection {
  endpoint: string;
  apiToken: string;
  insecure?: boolean;
}

export interface ProxmoxDiscovery {
  endpoint: string;
  nodes: DiscoveredNode[];
  templates: DiscoveredTemplate[];
  usedVmIds: number[];
  recommendations: {
    targetNodes: string[];
    templateVmIds: DiscoveredTemplate[];
    isoDatastoresByNode: Record<string, DiscoveredStorage[]>;
    vmDatastoresByNode: Record<string, DiscoveredStorage[]>;
    bridgesByNode: Record<string, DiscoveredNetwork[]>;
  };
  errors: string[];
  permissionHints: string[];
}

export interface ProxmoxDiagnostics {
  endpoint: string;
  version: unknown;
  effectivePermissions: Record<string, unknown>;
  firstOnlineNode?: string;
  sampleNodeInventory?: {
    storages: unknown[];
    qemu: unknown[];
    networks: unknown[];
  };
}

export interface DiscoveredNode {
  name: string;
  status?: string;
  cpu?: number;
  memoryBytes?: number;
  maxMemoryBytes?: number;
  storages: DiscoveredStorage[];
  networks: DiscoveredNetwork[];
  templates: DiscoveredTemplate[];
  vms: DiscoveredVm[];
}

export interface DiscoveredStorage {
  node: string;
  storage: string;
  type?: string;
  content: string[];
  active?: boolean;
  enabled?: boolean;
  shared?: boolean;
  availableBytes?: number;
  totalBytes?: number;
}

export interface DiscoveredNetwork {
  node: string;
  iface: string;
  type?: string;
  active?: boolean;
  autostart?: boolean;
  bridgePorts?: string;
  address?: string;
  cidr?: string;
  gateway?: string;
  vlanAware?: boolean;
  isBridge: boolean;
}

export interface DiscoveredVm {
  node: string;
  vmid: number;
  name?: string;
  status?: string;
  template: boolean;
}

export interface DiscoveredTemplate extends DiscoveredVm {
  template: true;
}

export interface ProxmoxApiResponse<T> {
  data: T;
}

export interface RawNode {
  node: string;
  status?: string;
  cpu?: number;
  mem?: number;
  maxmem?: number;
}

export interface RawStorage {
  storage: string;
  type?: string;
  content?: string;
  active?: number;
  enabled?: number;
  shared?: number;
  avail?: number;
  total?: number;
}

export interface RawNetwork {
  iface: string;
  type?: string;
  active?: number;
  autostart?: number;
  bridge_ports?: string;
  address?: string;
  cidr?: string;
  gateway?: string;
  vlan_aware?: number;
}

export interface RawVm {
  vmid: number;
  name?: string;
  status?: string;
  template?: number;
}
