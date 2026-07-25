import type { DeploymentModule } from "../types.js";

// Standalone GCP VPC (management/untrust/trust/panorama subnets + Cloud NAT + IAP
// ingress). Cheap to stand up on its own as a credentials smoke test, and the shared
// network other GCP deployments attach to via placement.network.mode "existing".
const deployment = {
  "name": "gcp-shared-network",
  "providerProfile": "gcp-lab",
  "provider": {
    "projectName": "gcp-lab-network",
    "vpcCidr": "10.140.0.0/16"
  },
  "steps": [
    {
      "name": "network-up",
      "action": "up",
      "targets": [
        "gcp-lab-network"
      ],
      "description": "Terraform creates the lab VPC, subnetworks, firewall rules, and Cloud NAT."
    }
  ],
  "resources": [
    {
      "kind": "network",
      "name": "gcp-lab-network",
      "hostname": "gcp-lab-network",
      "placement": {
        "provider": "gcp",
        "enableCloudNat": true,
        "enableIapIngress": true
      }
    }
  ]
} satisfies DeploymentModule;

export default deployment;
