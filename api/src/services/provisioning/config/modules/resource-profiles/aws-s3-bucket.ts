import type { ResourceProfileModule } from "../types.js";

const resourceProfile = {
  "name": "aws-s3-bucket",
  "provider": "aws",
  "kind": "s3-bucket",
  "terraform": {
    "stack": "terraform/aws-s3-bucket",
    "outputs": {
      "providerResourceId": "bucket.name"
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
      "bucket_name": {
        "path": "resource.bucket.name",
        "default": ""
      },
      "allowed_source_cidrs": {
        "first": [
          {
            "path": "resource.security.allowedSourceCidrs"
          },
          {
            "envListPath": "provider.allowedSourceCidrEnv"
          },
          {
            "resolver": "currentPublicIpCidrList"
          }
        ]
      },
      "force_destroy": {
        "path": "resource.destroy.forceDestroy",
        "default": true
      }
    }
  }
} satisfies ResourceProfileModule;

export default resourceProfile;
