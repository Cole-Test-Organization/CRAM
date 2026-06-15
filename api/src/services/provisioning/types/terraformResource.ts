import type { DeploymentConfig, ResourceConfig } from "./index.js";
import type { ProviderResourceContext } from "./providerAdapter.js";

export interface TerraformRunContext<TResource extends ResourceConfig> {
  configPath: string;
  configLoader: ProviderResourceContext<TResource>["configLoader"];
  stateRepository: ProviderResourceContext<TResource>["stateRepository"];
  deployment: DeploymentConfig;
  provider: DeploymentConfig["provider"];
  resource: TResource;
  placement: ResourceConfig["placement"];
}
