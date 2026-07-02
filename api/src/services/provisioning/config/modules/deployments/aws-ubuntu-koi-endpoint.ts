import type { DeploymentModule } from "../types.js";

// Ubuntu counterpart to aws-windows-endpoint: a standalone Ubuntu server that installs the Codex
// and Claude Code CLIs (codex-claude app profile) and adopts Koi during first-boot bootstrap.
//
// Koi requires its LINUX enrollment artifact — the Windows local-artifacts/windows/koi.py is a
// PowerShell shim and will not run here. Drop Koi's Linux installer at local-artifacts/linux/koi.sh
// (see local-artifacts/linux/README.md). A .py artifact is also supported; set koi.interpreter to
// python3 (or name the file koi.py, which the broker infers).
const deployment = {
  "name": "aws-ubuntu-koi-endpoint",
  "providerProfile": "aws-lab",
  "provider": {
    "projectName": "ubuntu-koi-lab",
    "vpcCidr": "10.140.0.0/16"
  },
  "steps": [
    {
      "name": "ubuntu-koi-up",
      "action": "up",
      "targets": [
        "ubuntu-koi-1"
      ],
      "description": "Terraform creates one Ubuntu endpoint that installs the CLIs and enrolls in Koi at first boot."
    },
    {
      "name": "ubuntu-koi-verify",
      "action": "verify-internet-access",
      "targets": [
        "ubuntu-koi-1"
      ],
      "description": "Broker verifies the bootstrap + Koi success markers, internet egress, Codex CLI, and Claude Code CLI."
    }
  ],
  "resources": [
    {
      "kind": "ubuntu-server",
      "name": "ubuntu-koi-1",
      "hostname": "ubuntu-koi-1",
      "vm": {
        "instanceType": "t3.small"
      },
      "appProfiles": [
        "codex-claude"
      ],
      "koi": {
        "scriptPath": "local-artifacts/linux/koi.sh",
        "arguments": [],
        "environment": {}
      },
      "bootstrap": {
        "verifyTimeoutSeconds": 1800
      },
      "placement": {
        "provider": "aws",
        "network": {
          "mode": "managed",
          "vpcCidr": "10.140.0.0/16",
          "subnetCidr": "10.140.40.0/24"
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
