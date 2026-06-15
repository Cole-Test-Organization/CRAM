import type {
  DeploymentConfig,
  FirewallConfig,
  PanwVmseriesResourceConfig,
  ProxmoxProviderConfig,
  ProxmoxVmseriesPlacement,
} from "../../types/index.js";
import { validatePanwVmseriesCommon } from "../../resources/palo/shared/validation.js";

export function toProxmoxFirewallConfig(
  deployment: DeploymentConfig,
  resource: PanwVmseriesResourceConfig,
  configPath: string,
): FirewallConfig {
  if (deployment.provider.type !== "proxmox") {
    throw new Error(
      `Invalid config ${configPath}: resource ${resource.hostname} uses provider ${deployment.provider.type}, not proxmox`,
    );
  }

  const placement = resource.placement as ProxmoxVmseriesPlacement;
  if (placement.provider && placement.provider !== "proxmox") {
    throw new Error(
      `Invalid config ${configPath}: resource ${resource.hostname} placement provider must be proxmox`,
    );
  }

  const provider = deployment.provider as ProxmoxProviderConfig;
  const config: FirewallConfig = {
    ...resource,
    proxmox: {
      endpointEnv: provider.endpointEnv,
      apiTokenEnv: provider.apiTokenEnv,
      insecure: provider.insecure,
      sshUsername: provider.sshUsername,
      targetNode: placement.targetNode ?? provider.defaultTargetNode ?? "",
      templateVmId: placement.templateVmId,
      templateNode: placement.templateNode ?? provider.defaultTemplateNode ?? placement.targetNode,
      vmId: placement.vmId ?? null,
      vmDatastoreId: placement.vmDatastoreId ?? provider.defaultVmDatastoreId ?? undefined,
      isoDatastoreId: placement.isoDatastoreId ?? provider.defaultIsoDatastoreId ?? "",
    },
    interfaces: placement.interfaces ?? [],
  };
  validateProxmoxFirewallConfig(config, `${configPath}:${resource.hostname}`);
  return config;
}

export function validateProxmoxFirewallConfig(config: FirewallConfig, configPath: string): void {
  const prefix = `Invalid config ${configPath}:`;
  validatePanwVmseriesCommon(config, prefix);
  if (!config.proxmox?.endpointEnv) throw new Error(`${prefix} proxmox.endpointEnv is required`);
  if (!config.proxmox?.apiTokenEnv) throw new Error(`${prefix} proxmox.apiTokenEnv is required`);
  if (!config.proxmox?.targetNode) throw new Error(`${prefix} proxmox.targetNode is required`);
  if (!config.proxmox?.templateVmId) throw new Error(`${prefix} proxmox.templateVmId is required`);
  if (!config.proxmox?.isoDatastoreId) {
    throw new Error(`${prefix} proxmox.isoDatastoreId is required`);
  }
  if (!config.interfaces?.length) throw new Error(`${prefix} at least one interface is required`);
  if (config.interfaces[0]?.name !== "mgmt") {
    throw new Error(`${prefix} interfaces[0] must be the management interface named "mgmt"`);
  }
}
