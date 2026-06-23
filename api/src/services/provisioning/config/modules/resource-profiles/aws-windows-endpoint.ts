import type { ResourceProfileModule } from "../types.js";

const resourceProfile = {
  "name": "aws-windows-endpoint",
  "provider": "aws",
  "kind": "windows-endpoint",
  "terraform": {
    "stack": "terraform/aws-windows-endpoint",
    "outputs": {
      "providerResourceId": "endpoint.instance_id"
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
            "value": "10.110.0.0/16"
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
            "value": "m5.large"
          }
        ]
      },
      "root_volume_gb": {
        "path": "placement.rootVolumeGb",
        "default": 128
      },
      "associate_public_ip": {
        "path": "placement.associatePublicIp",
        "default": true
      },
      "enable_winrm": {
        "path": "placement.enableWinrm",
        "default": false
      },
      "enable_ssm": {
        "path": "placement.enableSsm",
        "default": true
      },
      "bootstrap_method": {
        "path": "placement.bootstrapMethod",
        "default": "ssm"
      },
      "bootstrap_timeout_seconds": {
        "path": "placement.bootstrapTimeoutSeconds",
        "default": 1800
      },
      "admin_password": {
        "first": [
          {
            "path": "resource.bootstrap.adminPassword"
          },
          {
            "envPath": "resource.bootstrap.adminPasswordEnv"
          },
          {
            "value": ""
          }
        ]
      },
      "admin_username": {
        "path": "resource.bootstrap.adminUsername",
        "default": "Administrator"
      },
      "install_ssm_agent": {
        "path": "resource.bootstrap.installSsmAgent",
        "default": true
      },
      "install_python": {
        "path": "resource.bootstrap.installPython",
        "default": true
      },
      "python_install_url": {
        "path": "resource.bootstrap.pythonInstallUrl",
        "default": "https://www.python.org/ftp/python/3.14.5/python-3.14.5-amd64.exe"
      },
      "koi_script_inline": {
        "path": "resource.koi.scriptInline",
        "default": ""
      },
      "koi_script_sha256": {
        "path": "resource.koi.scriptSha256",
        "default": ""
      },
      "koi_arguments": {
        "path": "resource.koi.arguments",
        "default": []
      },
      "koi_environment": {
        "path": "resource.koi.environment",
        "default": {}
      },
      "applications": {
        "path": "resource.applications",
        "default": []
      }
    }
  }
} satisfies ResourceProfileModule;

export default resourceProfile;
