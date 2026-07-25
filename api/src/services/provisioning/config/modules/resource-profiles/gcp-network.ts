import type { ResourceProfileModule } from "../types.js";

const resourceProfile = {
  "name": "gcp-network",
  "provider": "gcp",
  "kind": "network",
  "terraform": {
    "stack": "terraform/gcp-network",
    "outputs": {
      "providerResourceId": "network.network_name"
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
      "vpc_cidr": {
        "path": "provider.vpcCidr",
        "default": "10.140.0.0/16"
      },
      "subnet_newbits": {
        "path": "placement.subnetNewbits",
        "default": 8
      },
      "management_subnet_index": {
        "path": "placement.managementSubnetIndex",
        "default": 0
      },
      "untrust_subnet_index": {
        "path": "placement.untrustSubnetIndex",
        "default": 10
      },
      "trust_subnet_index": {
        "path": "placement.trustSubnetIndex",
        "default": 20
      },
      "panorama_subnet_index": {
        "path": "placement.panoramaSubnetIndex",
        "default": 30
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
      "enable_cloud_nat": {
        "path": "placement.enableCloudNat",
        "default": true
      },
      "enable_iap_ingress": {
        "path": "placement.enableIapIngress",
        "default": true
      }
    }
  }
} satisfies ResourceProfileModule;

export default resourceProfile;
