import { GenericTerraformResourceAdapter } from "./genericTerraformResourceAdapter.js";
import { EksClusterResourceAdapter } from "./eks/eksClusterResourceAdapter.js";
import { PanoramaResourceAdapter } from "./palo/panorama/panoramaResourceAdapter.js";
import { VmSeriesResourceAdapter } from "./palo/vm-series/vmSeriesResourceAdapter.js";
import { PanwBootstrapService } from "./palo/shared/bootstrapService.js";
import { UbuntuServerResourceAdapter } from "./ubuntu/ubuntuServerResourceAdapter.js";
import { WindowsEndpointResourceAdapter } from "./windows/windowsEndpointResourceAdapter.js";
import { ResourceAdapterRegistry } from "./types.js";

export function createDefaultResourceAdapterRegistry(
  panwBootstrap = new PanwBootstrapService(),
): ResourceAdapterRegistry {
  const genericTerraform = new GenericTerraformResourceAdapter();
  return new ResourceAdapterRegistry(
    [
      new EksClusterResourceAdapter(),
      new PanoramaResourceAdapter(panwBootstrap),
      new VmSeriesResourceAdapter(panwBootstrap),
      new UbuntuServerResourceAdapter(),
      new WindowsEndpointResourceAdapter(),
    ],
    genericTerraform,
  );
}

export type {
  ResourceActionRequest,
  ResourceAdapter,
  ResourceAdapterContext,
  ResourceUpResult,
} from "./types.js";
export { ResourceAdapterRegistry } from "./types.js";
export { TerraformRunner } from "./terraformRunner.js";
