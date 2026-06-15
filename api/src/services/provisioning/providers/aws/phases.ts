import type { DeploymentStepConfig } from "../../types/index.js";

export const awsPanoramaFirewallSteps: DeploymentStepConfig[] = [
  {
    name: "panorama-up",
    action: "up",
    targets: ["panorama"],
    description: "Panorama adapter applies Terraform and bootstraps PAN-OS.",
  },
  {
    name: "firewalls-up",
    action: "up",
    targets: ["panw-vmseries"],
    description: "VM-Series adapters apply Terraform and bootstrap PAN-OS.",
  },
  {
    name: "panorama-verify-connected-resources",
    action: "verify-connected-resources",
    targets: ["panorama"],
    description: "Panorama adapter waits for the expected resources to register.",
  },
];
