import type { ProxmoxConnection } from "./proxmoxClient.js";

export interface ProxmoxPowerRuntime {
  connection: ProxmoxConnection;
  targetNode: string;
  vmId: number;
  hostname: string;
}

export interface ProxmoxVmStatus {
  status?: string;
}
