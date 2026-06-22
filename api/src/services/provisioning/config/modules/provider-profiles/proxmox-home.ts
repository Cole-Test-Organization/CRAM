import type { ProviderProfileModule } from "../types.js";

const providerProfile = {
  "name": "proxmox-home",
  "type": "proxmox",
  "endpointEnv": "PROXMOX_VE_ENDPOINT",
  "apiTokenEnv": "PROXMOX_VE_API_TOKEN",
  "insecure": true,
  "sshUsername": "root",
  "defaultTargetNode": "proxmox",
  "defaultTemplateNode": "proxmox",
  "defaultVmDatastoreId": "local-lvm",
  "defaultIsoDatastoreId": "local"
} satisfies ProviderProfileModule;

export default providerProfile;
