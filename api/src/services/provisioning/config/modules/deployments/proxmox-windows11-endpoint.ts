import type { DeploymentModule } from "../types.js";

const deployment = {
  "name": "proxmox-windows11-endpoint",
  "displayName": "Proxmox Windows 11 Endpoint",
  "providerProfile": "proxmox-home",
  "steps": [
    {
      "name": "endpoint-up",
      "action": "up",
      "targets": ["windows-proxmox2-02"],
      "description": "Clone, start, and bootstrap the Windows 11 Pro endpoint with RDP and SSH."
    }
  ],
  "resources": [
    {
      "kind": "windows-endpoint",
      "name": "windows-proxmox2-02",
      "hostname": "windows-proxmox2-02",
      "terraformProfile": "proxmox-windows-endpoint",
      "vm": {
        "cpuCores": 4,
        "memoryMb": 8192,
        "cpuType": "host",
        "started": true
      },
      "bootstrap": {
        "adminUsername": "hcwilk",
        "adminPasswordEnv": "WINDOWS_ENDPOINT_ADMIN_PASSWORD",
        "computerName": "WIN-PMX2-02",
        "enableRdp": true,
        "enableSsh": true
      },
      "placement": {
        "provider": "proxmox",
        "targetNode": "proxmox2",
        "sourceNode": "proxmox2",
        "sourceVmId": 139,
        "vmId": 807,
        "vmDatastoreId": "local-lvm",
        "agentEnabled": true,
        "agentTimeout": "15m",
        "waitForIpv4": true,
        "operatingSystemType": "win11",
        "bootstrapMethod": "qemu-agent",
        "bootstrapTimeoutSeconds": 900,
        "rdpPort": 3389,
        "sshPort": 22,
        "interfaces": [
          {
            "name": "lan",
            "bridge": "vmbr0",
            "model": "e1000",
            "vlanId": 20,
            "firewall": false
          }
        ]
      }
    }
  ]
} satisfies DeploymentModule;

export default deployment;
