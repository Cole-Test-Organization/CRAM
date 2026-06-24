import type { DeploymentModule } from "../types.js";

const deployment = {
  "name": "aws-panorama-lan",
  "providerProfile": "aws-lab",
  "provider": {
    "projectName": "panorama-lan",
    "panosVersionMajor": "11.2"
  },
  "steps": [
    {
      "name": "aws-apply-network",
      "action": "up",
      "targets": [
        "aws-shared-network"
      ],
      "description": "Terraform creates the shared AWS VPC and subnets."
    },
    {
      "name": "panorama-up",
      "action": "up",
      "targets": [
        "panorama-1"
      ],
      "description": "Panorama adapter creates the VM and bootstraps PAN-OS."
    }
  ],
  "resources": [
    {
      "kind": "network",
      "name": "aws-shared-network",
      "hostname": "aws-shared-network",
      "placement": {
        "provider": "aws",
        "availabilityZoneCount": 3,
        "subnetNewbits": 8,
        "managementSubnetStartIndex": 0,
        "untrustSubnetStartIndex": 10,
        "trustSubnetStartIndex": 20,
        "panoramaSubnetIndex": 30
      }
    },
    {
      "kind": "panorama",
      "name": "panorama-1",
      "hostname": "panorama-1",
      "vm": {
        "instanceType": "m5.4xlarge"
      },
      "management": {
        "type": "dhcp-client",
        "dnsPrimary": "8.8.8.8",
        "dnsSecondary": "8.8.4.4"
      },
      "license": {
        "authCodeEnv": "PANW_PANORAMA_AUTH_CODE",
        "serialEnv": "PANW_PANORAMA_SERIAL"
      },
      "bootstrap": {
        "adminPasswordEnv": "PANOS_ADMIN_PASSWORD",
        "tlsRejectUnauthorized": false,
        "readinessTimeoutSeconds": 2400,
        "generateVmAuthKey": true
      },
      "placement": {
        "provider": "aws",
        "vpcId": {
          "fromResource": "aws-shared-network",
          "output": "network.vpc_id"
        },
        "subnetId": {
          "fromResource": "aws-shared-network",
          "output": "network.panorama_subnet_id"
        },
        "availabilityZoneIndex": 0,
        "rootVolumeGb": 256,
        "logVolumeGb": 2048,
        "logVolumeDeviceName": "/dev/sdf",
        "attachManagementElasticIp": true
      }
    }
  ]
} satisfies DeploymentModule;

export default deployment;
