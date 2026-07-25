import type { ResourceProfileModule } from "../types.js";

const resourceProfile = {
  "name": "gcp-ubuntu-server",
  "provider": "gcp",
  "kind": "ubuntu-server",
  "terraform": {
    "stack": "terraform/gcp-ubuntu-server",
    "outputs": {
      // The instance name (not the numeric id) is what `gcloud compute instances
      // describe` takes, so it is the handle the provider adapter records.
      "providerResourceId": "server.instance_name"
    },
    "environment": {
      "GOOGLE_APPLICATION_CREDENTIALS": {
        "envPath": "provider.credentialsFileEnv",
        "optional": true
      },
      "GOOGLE_CREDENTIALS": {
        "envPath": "provider.credentialsEnv",
        "optional": true
      }
    },
    "vars": {
      "project": {
        "first": [
          {
            "path": "provider.project"
          },
          {
            "envPath": "provider.projectEnv"
          }
        ]
      },
      "region": {
        "first": [
          {
            "path": "provider.region"
          },
          {
            "envPath": "provider.regionEnv"
          }
        ]
      },
      "zone": {
        "first": [
          {
            "path": "placement.zone"
          },
          {
            "path": "provider.zone"
          },
          {
            "value": null
          }
        ]
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
            "value": "10.140.0.0/16"
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
      "network": {
        "first": [
          {
            "path": "placement.network.networkName"
          },
          {
            "path": "placement.network.vpcId"
          },
          {
            "value": null
          }
        ]
      },
      "subnetwork": {
        "first": [
          {
            "path": "placement.network.subnetworkName"
          },
          {
            "path": "placement.network.subnetId"
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
      "admin_username": {
        "path": "placement.adminUsername",
        "default": "ubuntu"
      },
      "admin_public_key": { "resolver": "localSshPublicKey" },
      "machine_type": {
        "first": [
          {
            "path": "resource.vm.machineType"
          },
          {
            "path": "resource.vm.instanceType"
          },
          {
            "path": "placement.machineType"
          },
          {
            "value": "e2-standard-2"
          }
        ]
      },
      "image": {
        "first": [
          {
            "path": "resource.vm.image"
          },
          {
            "path": "placement.image"
          },
          {
            "value": "ubuntu-os-cloud/ubuntu-2404-lts-amd64"
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
      "enable_iap": {
        "path": "placement.enableIap",
        "default": true
      },
      "enable_cloud_nat": {
        "path": "placement.enableCloudNat",
        "default": true
      },
      "service_account_email": {
        "first": [
          {
            "path": "placement.serviceAccountEmail"
          },
          {
            "path": "provider.serviceAccountEmail"
          },
          {
            "value": null
          }
        ]
      },
      "bootstrap_packages": {
        "path": "resource.bootstrap.packages",
        "default": []
      },
      "bootstrap_commands": {
        "path": "resource.bootstrap.commands",
        "default": []
      },
      "koi_script_inline": {
        "path": "resource.koi.scriptInline",
        "default": ""
      },
      "koi_script_sha256": {
        "path": "resource.koi.scriptSha256",
        "default": ""
      },
      "koi_interpreter": {
        "path": "resource.koi.interpreter",
        "default": "bash"
      },
      "koi_arguments": {
        "path": "resource.koi.arguments",
        "default": []
      },
      "koi_environment": {
        "path": "resource.koi.environment",
        "default": {}
      }
    }
  }
} satisfies ResourceProfileModule;

export default resourceProfile;
