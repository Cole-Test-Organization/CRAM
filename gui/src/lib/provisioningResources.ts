import type { ProvisioningResource } from './api';

export function isActiveProvisioningResource(resource: ProvisioningResource): boolean {
  return resource.lifecycleStatus !== 'destroyed';
}

export function activeProvisioningResources(resources: ProvisioningResource[]): ProvisioningResource[] {
  return resources.filter(isActiveProvisioningResource);
}
