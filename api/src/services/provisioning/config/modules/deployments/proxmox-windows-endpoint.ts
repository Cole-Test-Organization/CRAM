import type { DeploymentModule } from "../types.js";

const deployment = {
  "name": "proxmox-windows-endpoint",
  "displayName": "Proxmox Windows Endpoint",
  "providerProfile": "proxmox-home",
  "steps": [
    {
      "name": "endpoint-up",
      "action": "up",
      "targets": ["windows-proxmox2-01"],
      "description": "Clone, start, and wait for the Windows endpoint guest agent and IPv4 address."
    }
  ],
  "resources": [
    {
      "kind": "windows-endpoint",
      "name": "windows-proxmox2-01",
      "hostname": "windows-proxmox2-01",
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
        "computerName": "WIN-PMX2-01",
        "enableRdp": false,
        "enableSsh": true
      },
      "placement": {
        "provider": "proxmox",
        "targetNode": "proxmox2",
        "sourceNode": "proxmox",
        "sourceVmId": 120,
        "vmId": 806,
        "vmDatastoreId": "local-lvm",
        "agentEnabled": true,
        "agentTimeout": "15m",
        "waitForIpv4": true,
        "operatingSystemType": "win11",
        "bootstrapMethod": "qemu-agent",
        "bootstrapTimeoutSeconds": 900,
        "rdpPort": null,
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
