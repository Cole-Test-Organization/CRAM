import type { ResourceProfileModule } from "../types.js";

const resourceProfile = {
  "name": "aws-panw-vmseries",
  "provider": "aws",
  "kind": "panw-vmseries",
  "terraform": {
    "stack": "terraform/aws-panw-vmseries",
    "outputs": {
      "providerResourceId": "firewall.instance_id"
    },
    "environment": {
      "AWS_PROFILE": {
        "envPath": "provider.profileEnv",
        "optional": true
      }
    },
    "vars": {
      "region": {
        "path": "provider.region"
      },
      "project_name": {
        "first": [
          {
            "path": "provider.projectName"
          },
          {
            "path": "deployment.name"
          }
        ]
      },
      "hostname": {
        "path": "resource.hostname"
      },
      "vpc_cidr": {
        "path": "provider.vpcCidr",
        "default": "10.100.0.0/16"
      },
      "vpc_id": {
        "first": [
          {
            "path": "placement.network.vpcId"
          },
          {
            "path": "placement.vpcId"
          },
          {
            "value": null
          }
        ]
      },
      "management_subnet_cidr": {
        "first": [
          {
            "path": "placement.network.interfaces.management.subnetCidr"
          },
          {
            "path": "placement.managementSubnetCidr"
          },
          {
            "value": null
          }
        ]
      },
      "management_subnet_id": {
        "first": [
          {
            "path": "placement.network.interfaces.management.subnetId"
          },
          {
            "path": "placement.managementSubnetId"
          },
          {
            "value": null
          }
        ]
      },
      "untrust_subnet_cidr": {
        "first": [
          {
            "path": "placement.network.interfaces.untrust.subnetCidr"
          },
          {
            "path": "placement.untrustSubnetCidr"
          },
          {
            "value": null
          }
        ]
      },
      "untrust_subnet_id": {
        "first": [
          {
            "path": "placement.network.interfaces.untrust.subnetId"
          },
          {
            "path": "placement.untrustSubnetId"
          },
          {
            "value": null
          }
        ]
      },
      "trust_subnet_cidr": {
        "first": [
          {
            "path": "placement.network.interfaces.trust.subnetCidr"
          },
          {
            "path": "placement.trustSubnetCidr"
          },
          {
            "value": null
          }
        ]
      },
      "trust_subnet_id": {
        "first": [
          {
            "path": "placement.network.interfaces.trust.subnetId"
          },
          {
            "path": "placement.trustSubnetId"
          },
          {
            "value": null
          }
        ]
      },
      "availability_zone_index": {
        "path": "placement.availabilityZoneIndex",
        "default": 0
      },
      "allowed_source_cidrs": {
        "first": [
          {
            "envListPath": "provider.allowedSourceCidrEnv"
          },
          {
            "resolver": "currentPublicIpCidrList"
          }
        ]
      },
      "ssh_public_key": { "resolver": "localSshPublicKey" },
      "panos_version_major": {
        "path": "provider.panosVersionMajor",
        "default": "11.2"
      },
      "instance_type": {
        "first": [
          {
            "path": "resource.vm.instanceType"
          },
          {
            "path": "placement.instanceType"
          },
          {
            "value": "m5.xlarge"
          }
        ]
      },
      "root_volume_gb": {
        "path": "placement.rootVolumeGb",
        "default": 60
      },
      "dns_primary": {
        "path": "resource.management.dnsPrimary",
        "default": "8.8.8.8"
      },
      "dns_secondary": {
        "path": "resource.management.dnsSecondary",
        "default": "8.8.4.4"
      },
      "auth_code": {
        "first": [
          {
            "path": "resource.license.authCode"
          },
          {
            "envPath": "resource.license.authCodeEnv"
          }
        ]
      },
      "management_server_mode": {
        "path": "resource.managementServer.mode",
        "default": "panorama"
      },
      "panorama_server": {
        "path": "resource.managementServer.panoramaServer",
        "default": ""
      },
      "panorama_server2": {
        "path": "resource.managementServer.panoramaServer2",
        "default": ""
      },
      "vm_auth_key": {
        "first": [
          {
            "path": "resource.managementServer.vmAuthKey"
          },
          {
            "envPath": "resource.managementServer.vmAuthKeyEnv"
          },
          {
            "value": ""
          }
        ]
      },
      "scm_folder": {
        "path": "resource.managementServer.folder",
        "default": ""
      },
      "device_cert_pin_id": {
        "first": [
          {
            "path": "resource.deviceCertificate.pinId"
          },
          {
            "envPath": "resource.deviceCertificate.pinIdEnv"
          },
          {
            "value": ""
          }
        ]
      },
      "device_cert_pin_value": {
        "first": [
          {
            "path": "resource.deviceCertificate.pinValue"
          },
          {
            "envPath": "resource.deviceCertificate.pinValueEnv"
          },
          {
            "value": ""
          }
        ]
      },
      "role": {
        "path": "placement.role",
        "default": "gateway"
      },
      "attach_management_elastic_ip": {
        "path": "placement.attachManagementElasticIp",
        "default": true
      },
      "attach_untrust_elastic_ip": {
        "path": "placement.attachUntrustElasticIp",
        "default": true
      }
    }
  }
} satisfies ResourceProfileModule;

export default resourceProfile;
