import type { DeploymentModule } from "../types.js";

// GCP counterpart to aws-ubuntu-server: one standalone Ubuntu box with egress, the same
// codex-claude app profile, and IAP left on so the broker's SSH tunnel works without a
// public IP. There is no verify step — the marker probe runs over AWS SSM, and GCP's
// equivalent (an IAP SSH exec) is not wired up yet.
const deployment = {
  "name": "gcp-ubuntu-server",
  "providerProfile": "gcp-lab",
  "provider": {
    "projectName": "ubuntu-server-lab",
    "vpcCidr": "10.140.0.0/16"
  },
  "steps": [
    {
      "name": "ubuntu-server-up",
      "action": "up",
      "targets": [
        "gcp-ubuntu-dev-1"
      ],
      "description": "Terraform creates one standalone Ubuntu instance with Cloud NAT egress."
    }
  ],
  "resources": [
    {
      "kind": "ubuntu-server",
      "name": "gcp-ubuntu-dev-1",
      "hostname": "gcp-ubuntu-dev-1",
      "vm": {
        "machineType": "e2-standard-2"
      },
      "appProfiles": [
        "codex-claude"
      ],
      "placement": {
        "provider": "gcp",
        "network": {
          "mode": "managed",
          "vpcCidr": "10.140.0.0/16",
          "subnetCidr": "10.140.40.0/24"
        },
        // allowedSourceCidrs omitted: the resource profile falls back to
        // currentPublicIpCidrList, scoping SSH to the operator's own public IP.
        "rootVolumeGb": 32,
        "associatePublicIp": true,
        "enableSsh": true,
        "enableIap": true,
        "enableCloudNat": true
      }
    }
  ]
} satisfies DeploymentModule;

export default deployment;
