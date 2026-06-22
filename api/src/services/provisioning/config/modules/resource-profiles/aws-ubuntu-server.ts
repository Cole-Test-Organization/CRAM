import type { ResourceProfileModule } from "../types.js";

const resourceProfile = {
  "name": "aws-ubuntu-server",
  "provider": "aws",
  "kind": "ubuntu-server",
  "terraform": {
    "stack": "terraform/aws-ubuntu-server",
    "outputs": {
      "providerResourceId": "server.instance_id"
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
        "first": [
          {
            "path": "placement.network.vpcCidr"
          },
          {
            "path": "provider.vpcCidr"
          },
          {
            "value": "10.130.0.0/16"
          }
        ]
      },
      "network_mode": {
        "first": [
          {
            "path": "placement.network.mode"
          },
          {
            "value": "managed"
          }
        ]
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
      "availability_zone_index": {
        "path": "placement.availabilityZoneIndex",
        "default": 0
      },
      "allowed_source_cidrs": {
        "first": [
          {
            "path": "placement.allowedSourceCidrs"
          },
          {
            "path": "provider.allowedSourceCidrs"
          },
          {
            "envListPath": "provider.allowedSourceCidrEnv"
          },
          {
            "resolver": "currentPublicIpCidrList"
          }
        ]
      },
      "admin_public_key": {
        "first": [
          {
            "envPath": "provider.sshPublicKeyEnv"
          },
          {
            "resolver": "localSshPublicKey"
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
            "value": "t3.small"
          }
        ]
      },
      "root_volume_gb": {
        "path": "placement.rootVolumeGb",
        "default": 32
      },
      "associate_public_ip": {
        "path": "placement.associatePublicIp",
        "default": true
      },
      "enable_ssh": {
        "path": "placement.enableSsh",
        "default": true
      },
      "enable_ssm": {
        "path": "placement.enableSsm",
        "default": true
      },
      "bootstrap_packages": {
        "path": "resource.bootstrap.packages",
        "default": []
      },
      "bootstrap_commands": {
        "path": "resource.bootstrap.commands",
        "default": []
      }
    }
  }
} satisfies ResourceProfileModule;

export default resourceProfile;
