import type { ResourceProfileModule } from "../types.js";

const resourceProfile = {
  "name": "aws-panorama",
  "provider": "aws",
  "kind": "panorama",
  "terraform": {
    "stack": "terraform/aws-panorama",
    "outputs": {
      "providerResourceId": "panorama.instance_id"
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
        "path": "provider.projectName",
        "defaultPath": "deployment.name"
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
      "subnet_cidr": {
        "first": [
          {
            "path": "placement.network.subnetCidr"
          },
          {
            "path": "placement.subnetCidr"
          },
          {
            "value": null
          }
        ]
      },
      "subnet_id": {
        "first": [
          {
            "path": "placement.network.subnetId"
          },
          {
            "path": "placement.subnetId"
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
        "first": [
          {
            "path": "provider.panoramaPanosVersionMajor"
          },
          {
            "path": "provider.panosVersionMajor"
          },
          {
            "value": "11.2"
          }
        ]
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
            "value": "m5.4xlarge"
          }
        ]
      },
      "root_volume_gb": {
        "path": "placement.rootVolumeGb",
        "default": 256
      },
      "log_volume_gb": {
        "path": "placement.logVolumeGb",
        "default": 2048
      },
      "log_volume_device_name": {
        "path": "placement.logVolumeDeviceName",
        "default": "/dev/sdf"
      },
      "dns_primary": {
        "path": "resource.management.dnsPrimary",
        "default": "8.8.8.8"
      },
      "dns_secondary": {
        "path": "resource.management.dnsSecondary",
        "default": "8.8.4.4"
      },
      "serial": {
        "first": [
          {
            "path": "resource.license.serial"
          },
          {
            "envPath": "resource.license.serialEnv"
          },
          {
            "value": ""
          }
        ]
      }
    }
  }
} satisfies ResourceProfileModule;

export default resourceProfile;
