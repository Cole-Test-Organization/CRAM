import type { DeploymentModule } from "../types.js";

const deployment = {
  "name": "aws-ubuntu-server",
  "providerProfile": "aws-lab",
  "provider": {
    "projectName": "ubuntu-server-lab",
    "vpcCidr": "10.130.0.0/16"
  },
  "steps": [
    {
      "name": "ubuntu-server-up",
      "action": "up",
      "targets": [
        "ubuntu-dev-1"
      ],
      "description": "Terraform creates one standalone Ubuntu server with direct internet egress."
    },
    {
      "name": "ubuntu-server-verify",
      "action": "verify-internet-access",
      "targets": [
        "ubuntu-dev-1"
      ],
      "description": "Broker verifies the Ubuntu bootstrap marker, internet egress, Codex CLI, and Claude Code CLI."
    }
  ],
  "resources": [
    {
      "kind": "ubuntu-server",
      "name": "ubuntu-dev-1",
      "hostname": "ubuntu-dev-1",
      "vm": {
        "instanceType": "t3.small"
      },
      "appProfiles": [
        "codex-claude"
      ],
      "bootstrap": {
        "verifyTimeoutSeconds": 1800
      },
      "placement": {
        "provider": "aws",
        "network": {
          "mode": "managed",
          "vpcCidr": "10.130.0.0/16",
          "subnetCidr": "10.130.40.0/24"
        },
        "availabilityZoneIndex": 0,
        // allowedSourceCidrs omitted: the resource profile falls back to currentPublicIpCidrList,
        // scoping the security group to the operator's own public IP. Set placement.allowedSourceCidrs
        // (or the provider's allowedSourceCidrEnv) to widen it.
        "rootVolumeGb": 32,
        "associatePublicIp": true,
        "enableSsh": true,
        "enableSsm": true
      }
    }
  ]
} satisfies DeploymentModule;

export default deployment;
