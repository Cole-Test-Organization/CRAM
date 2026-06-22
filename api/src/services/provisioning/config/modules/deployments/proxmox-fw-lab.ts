import type { DeploymentModule } from "../types.js";

const deployment = {
  "name": "proxmox-fw-lab",
  "provider": {
    "type": "proxmox",
    "endpointEnv": "PROXMOX_VE_ENDPOINT",
    "apiTokenEnv": "PROXMOX_VE_API_TOKEN",
    "insecure": true,
    "sshUsername": "root",
    "defaultTargetNode": "proxmox",
    "defaultTemplateNode": "proxmox",
    "defaultVmDatastoreId": "local-lvm",
    "defaultIsoDatastoreId": "local"
  },
  "resources": [
    {
      "kind": "panw-vmseries",
      "name": "fw-lab-02",
      "hostname": "fw-lab-02",
      "vm": {
        "cpuCores": 4,
        "memoryMb": 8192,
        "cpuType": "host",
        "started": true
      },
      "management": {
        "type": "static",
        "ipAddress": "10.0.20.5",
        "netmask": "255.255.255.0",
        "defaultGateway": "10.0.20.1",
        "dnsPrimary": "1.1.1.1",
        "dnsSecondary": "8.8.8.8"
      },
      "license": {
        "authCodeEnv": "PANW_NGFW_AUTH_CODE"
      },
      "managementServer": {
        "mode": "panorama",
        "panoramaServer": "10.0.20.4",
        "vmAuthKeyEnv": "PANW_VM_AUTH_KEY",
        "templateStack": null,
        "deviceGroup": null
      },
      "deviceCertificate": {
        "pinIdEnv": "PANW_DEVICE_CERT_PIN_ID",
        "pinValueEnv": "PANW_DEVICE_CERT_PIN_VALUE"
      },
      "placement": {
        "provider": "proxmox",
        "templateVmId": 800,
        "vmId": 802,
        "interfaces": [
          {
            "name": "mgmt",
            "bridge": "vmbr0",
            "model": "virtio",
            "vlanId": 20
          },
          {
            "name": "untrust",
            "bridge": "vmbr1",
            "model": "virtio"
          }
        ]
      },
      "destroy": {
        "allowWithoutDelicense": true
      }
    },
    {
      "kind": "panw-vmseries",
      "name": "fw-lab-03",
      "hostname": "fw-lab-03",
      "vm": {
        "cpuCores": 4,
        "memoryMb": 8192,
        "cpuType": "host",
        "started": true
      },
      "management": {
        "type": "static",
        "ipAddress": "10.0.20.6",
        "netmask": "255.255.255.0",
        "defaultGateway": "10.0.20.1",
        "dnsPrimary": "1.1.1.1",
        "dnsSecondary": "8.8.8.8"
      },
      "license": {
        "authCodeEnv": "PANW_NGFW_AUTH_CODE"
      },
      "managementServer": {
        "mode": "panorama",
        "panoramaServer": "10.0.20.4",
        "vmAuthKeyEnv": "PANW_VM_AUTH_KEY",
        "templateStack": null,
        "deviceGroup": null
      },
      "deviceCertificate": {
        "pinIdEnv": "PANW_DEVICE_CERT_PIN_ID",
        "pinValueEnv": "PANW_DEVICE_CERT_PIN_VALUE"
      },
      "placement": {
        "provider": "proxmox",
        "templateVmId": 800,
        "vmId": 803,
        "interfaces": [
          {
            "name": "mgmt",
            "bridge": "vmbr0",
            "model": "virtio",
            "vlanId": 20
          },
          {
            "name": "untrust",
            "bridge": "vmbr1",
            "model": "virtio"
          }
        ]
      },
      "destroy": {
        "allowWithoutDelicense": true
      }
    }
  ]
} satisfies DeploymentModule;

export default deployment;
