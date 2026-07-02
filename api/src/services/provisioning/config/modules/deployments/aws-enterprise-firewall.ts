import type { DeploymentModule } from "../types.js";

const deployment = {
  "name": "aws-enterprise-firewall",
  "providerProfile": "aws-lab",
  "provider": {
    "projectName": "enterprise-firewall-lab",
    "vpcCidr": "10.125.0.0/16",
    "panosVersionMajor": "11.2"
  },
  "steps": [
    {
      "name": "aws-network-up",
      "action": "up",
      "targets": [
        "aws-enterprise-firewall-network"
      ],
      "description": "Terraform creates a dedicated one-AZ VPC with management, untrust, and trust subnets."
    },
    {
      "name": "firewall-up",
      "action": "up",
      "targets": [
        "enterprise-fw-1"
      ],
      "description": "Terraform creates one standalone VM-Series firewall."
    },
    {
      "name": "firewall-bootstrap",
      "action": "bootstrap",
      "targets": [
        "enterprise-fw-1"
      ],
      "description": "VM-Series adapter sets the admin password and fetches the VM-Series license."
    },
    {
      "name": "firewall-apply-enterprise-rule-stack",
      "action": "apply-config-addons",
      "targets": [
        "enterprise-fw-1"
      ],
      "params": {
        "addOn": "enterprise-rule-stack"
      },
      "description": "VM-Series adapter applies the enterprise micro-segmentation and exception policy template."
    },
    {
      "name": "trust-egress-route-up",
      "action": "up",
      "targets": [
        "enterprise-trust-default-egress"
      ],
      "description": "Terraform routes the trust subnet default route through the firewall trust interface."
    },
    {
      "name": "windows-endpoint-up",
      "action": "up",
      "targets": [
        "enterprise-win-user-1"
      ],
      "description": "Windows endpoint in the protected trust subnet for policy enforcement testing."
    }
  ],
  "resources": [
    {
      "kind": "network",
      "name": "aws-enterprise-firewall-network",
      "hostname": "aws-enterprise-firewall-network",
      "placement": {
        "provider": "aws",
        "availabilityZoneCount": 1,
        "subnetNewbits": 8,
        "managementSubnetStartIndex": 0,
        "untrustSubnetStartIndex": 10,
        "trustSubnetStartIndex": 20,
        "panoramaSubnetIndex": 30
      }
    },
    {
      "kind": "panw-vmseries",
      "name": "enterprise-fw-1",
      "hostname": "enterprise-fw-1",
      "vm": {
        "cpuCores": 4,
        "memoryMb": 8192,
        "instanceType": "m5.xlarge",
        "started": true
      },
      "management": {
        "type": "dhcp-client",
        "dnsPrimary": "8.8.8.8",
        "dnsSecondary": "8.8.4.4"
      },
      "license": {
        "authCodeEnv": "PANW_NGFW_AUTH_CODE",
        "deactivationApiKeyEnv": "PANW_LICENSE_DEACTIVATION_API_KEY"
      },
      "managementServer": {
        "mode": "none"
      },
      "bootstrap": {
        "adminPasswordEnv": "PANOS_ADMIN_PASSWORD",
        "readinessTimeoutSeconds": 2400
      },
      "configProfiles": [
        "enterprise-rule-stack"
      ],
      "placement": {
        "provider": "aws",
        "role": "gateway",
        "availabilityZoneIndex": 0,
        "network": {
          "mode": "existing",
          "vpcId": {
            "fromResource": "aws-enterprise-firewall-network",
            "output": "network.vpc_id"
          },
          "interfaces": {
            "management": {
              "subnetId": {
                "fromResource": "aws-enterprise-firewall-network",
                "output": "network.management_subnet_ids.0"
              }
            },
            "untrust": {
              "subnetId": {
                "fromResource": "aws-enterprise-firewall-network",
                "output": "network.untrust_subnet_ids.0"
              }
            },
            "trust": {
              "subnetId": {
                "fromResource": "aws-enterprise-firewall-network",
                "output": "network.trust_subnet_ids.0"
              }
            }
          }
        },
        "managementSubnetName": "mgmt-a",
        "untrustSubnetName": "untrust-a",
        "trustSubnetName": "trust-a",
        "attachManagementElasticIp": true,
        "attachUntrustElasticIp": true
      }
    },
    {
      "kind": "egress-route",
      "name": "enterprise-trust-default-egress",
      "hostname": "enterprise-trust-default-egress",
      "placement": {
        "provider": "aws",
        "network": {
          "mode": "existing",
          "routeTableId": {
            "fromResource": "aws-enterprise-firewall-network",
            "output": "network.trust_route_table_ids.0"
          },
          "destinationCidr": "0.0.0.0/0",
          "nextHop": {
            "type": "network-interface",
            "networkInterfaceId": {
              "fromResource": "enterprise-fw-1",
              "output": "firewall.trust_network_interface_id"
            }
          }
        }
      }
    },
    {
      "kind": "windows-endpoint",
      "name": "enterprise-win-user-1",
      "hostname": "enterprise-win-user-1",
      "vm": {
        "instanceType": "m5.large"
      },
      "bootstrap": {
        "adminUsername": "enterprise-user",
        "adminPasswordEnv": "WINDOWS_ENDPOINT_ADMIN_PASSWORD",
        "installSsmAgent": true,
        "installPython": true,
        "pythonInstallUrl": "https://www.python.org/ftp/python/3.14.5/python-3.14.5-amd64.exe"
      },
      "placement": {
        "provider": "aws",
        "network": {
          "mode": "existing",
          "vpcId": {
            "fromResource": "aws-enterprise-firewall-network",
            "output": "network.vpc_id"
          },
          "subnetId": {
            "fromResource": "aws-enterprise-firewall-network",
            "output": "network.trust_subnet_ids.0"
          }
        },
        "availabilityZoneIndex": 0,
        "rootVolumeGb": 128,
        "associatePublicIp": false,
        "enableWinrm": false,
        "enableSsm": true,
        "bootstrapMethod": "ssm",
        "bootstrapTimeoutSeconds": 1800
      }
    }
  ]
} satisfies DeploymentModule;

export default deployment;
