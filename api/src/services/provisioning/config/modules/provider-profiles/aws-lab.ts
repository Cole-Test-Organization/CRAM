import type { ProviderProfileModule } from "../types.js";

const providerProfile = {
  "name": "aws-lab",
  "type": "aws",
  "region": "us-west-2",
  "profileEnv": "AWS_PROFILE",
  "vpcCidr": "10.100.0.0/16",
  "allowedSourceCidrEnv": "AWS_GP_LAB_ALLOWED_SOURCE_CIDRS",
  "sshPublicKeyEnv": "AWS_GP_LAB_SSH_PUBLIC_KEY",
  "panosVersionMajor": "11.2"
} satisfies ProviderProfileModule;

export default providerProfile;
