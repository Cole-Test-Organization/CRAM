import type { ResourceProfileModule } from "../types.js";

const resourceProfile = {
  "name": "aws-network",
  "provider": "aws",
  "kind": "network",
  "terraform": {
    "stack": "terraform/aws-network",
    "outputs": {
      "providerResourceId": "network.vpc_id"
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
      "vpc_cidr": {
        "path": "provider.vpcCidr",
        "default": "10.100.0.0/16"
      },
      "availability_zone_count": {
        "path": "placement.availabilityZoneCount",
        "default": 3
      },
      "subnet_newbits": {
        "path": "placement.subnetNewbits",
        "default": 8
      },
      "management_subnet_start_index": {
        "path": "placement.managementSubnetStartIndex",
        "default": 0
      },
      "untrust_subnet_start_index": {
        "path": "placement.untrustSubnetStartIndex",
        "default": 10
      },
      "trust_subnet_start_index": {
        "path": "placement.trustSubnetStartIndex",
        "default": 20
      },
      "panorama_subnet_index": {
        "path": "placement.panoramaSubnetIndex",
        "default": 30
      }
    }
  }
} satisfies ResourceProfileModule;

export default resourceProfile;
