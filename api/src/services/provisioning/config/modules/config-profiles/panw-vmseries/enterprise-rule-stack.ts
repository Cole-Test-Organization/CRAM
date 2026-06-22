import type { ConfigProfileModule } from "../../types.js";

const configProfile = {
  "name": "enterprise-rule-stack",
  "description": "Standalone VM-Series enterprise baseline with segmented zones, least-privilege policies, exceptions, NAT, and logging.",
  "configAddOns": [
    {
      "name": "enterprise-rule-stack",
      "file": "pan-os-configs/panw-vmseries-config-addons/enterprise-rule-stack.xml",
      "commit": true
    }
  ]
} satisfies ConfigProfileModule;

export default configProfile;
