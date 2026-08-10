import type { ResourceProfileModule } from "../types.js";

const resourceProfile = {
  "name": "proxmox-windows-endpoint",
  "provider": "proxmox",
  "kind": "windows-endpoint",
  "terraform": {
    "stack": "terraform/proxmox-windows-endpoint",
    "outputs": {
      "providerResourceId": "endpoint.instance_id"
    },
    "environment": {
      "TF_VAR_proxmox_endpoint": {
        "envPath": "provider.endpointEnv"
      },
      "TF_VAR_proxmox_api_token": {
        "envPath": "provider.apiTokenEnv"
      }
    },
    "vars": {
      "proxmox_insecure": {
        "path": "provider.insecure",
        "default": true
      },
      "proxmox_ssh_username": {
        "path": "provider.sshUsername",
        "default": "root"
      },
      "target_node": {
        "path": "placement.targetNode",
        "defaultPath": "provider.defaultTargetNode"
      },
      "source_node": {
        "path": "placement.sourceNode",
        "defaultPath": "provider.defaultTemplateNode"
      },
      "source_vm_id": {
        "path": "placement.sourceVmId"
      },
      "vm_id": {
        "path": "placement.vmId",
        "default": null
      },
      "vm_name": {
        "path": "resource.hostname"
      },
      "cpu_cores": {
        "path": "resource.vm.cpuCores",
        "default": 4
      },
      "cpu_type": {
        "path": "resource.vm.cpuType",
        "default": "host"
      },
      "memory_mb": {
        "path": "resource.vm.memoryMb",
        "default": 8192
      },
      "started": {
        "path": "resource.vm.started",
        "default": true
      },
      "vm_datastore_id": {
        "path": "placement.vmDatastoreId",
        "defaultPath": "provider.defaultVmDatastoreId",
        "default": "local-lvm"
      },
      "interfaces": {
        "path": "placement.interfaces",
        "default": [
          {
            "name": "lan",
            "bridge": "vmbr0",
            "model": "e1000",
            "firewall": false
          }
        ]
      },
      "agent_enabled": {
        "path": "placement.agentEnabled",
        "default": true
      },
      "agent_timeout": {
        "path": "placement.agentTimeout",
        "default": "15m"
      },
      "wait_for_ipv4": {
        "path": "placement.waitForIpv4",
        "default": true
      },
      "operating_system_type": {
        "path": "placement.operatingSystemType",
        "default": "win11"
      },
      "admin_username": {
        "path": "resource.bootstrap.adminUsername",
        "default": "Administrator"
      },
      "rdp_port": {
        "path": "placement.rdpPort",
        "default": null
      },
      "ssh_port": {
        "path": "placement.sshPort",
        "default": null
      },
      "tags": {
        "path": "placement.tags",
        "default": ["panw-broker", "windows-endpoint"]
      }
    }
  }
} satisfies ResourceProfileModule;

export default resourceProfile;
