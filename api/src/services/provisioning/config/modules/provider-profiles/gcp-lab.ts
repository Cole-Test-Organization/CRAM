import type { ProviderProfileModule } from "../types.js";

// GCP counterpart to aws-lab. `project`/`region` are literals with `*Env` indirections
// so a machine can override them without editing config; credentialsFileEnv points at a
// service-account key path when ADC is not used (gcloud login is the default path).
const providerProfile = {
  "name": "gcp-lab",
  "type": "gcp",
  "project": "",
  "projectEnv": "GCP_PROJECT",
  "region": "us-west1",
  "regionEnv": "GCP_REGION",
  "zone": "us-west1-a",
  "credentialsFileEnv": "GOOGLE_APPLICATION_CREDENTIALS",
  "vpcCidr": "10.140.0.0/16",
  "allowedSourceCidrEnv": "GCP_LAB_ALLOWED_SOURCE_CIDRS"
} satisfies ProviderProfileModule;

export default providerProfile;
