import type { ConfigProfileModule } from "../../types.js";

const configProfile = {
  "name": "internet-egress",
  "description": "Standalone VM-Series baseline for DHCP trust/untrust interfaces and trust-to-internet egress.",
  "configAddOns": [
    {
      "name": "internet-egress",
      "file": "pan-os-configs/panw-vmseries-config-addons/internet-egress.xml",
      "commit": true
    }
  ]
} satisfies ConfigProfileModule;

export default configProfile;
