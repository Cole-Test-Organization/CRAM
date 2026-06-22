import { describe, expect, it } from 'vitest';
import type { ProvisioningResource } from './api';
import { activeProvisioningResources, isActiveProvisioningResource } from './provisioningResources';

function resource(lifecycleStatus: string): ProvisioningResource {
  return {
    id: `res-${lifecycleStatus}`,
    deploymentId: 'aws-lab',
    name: null,
    hostname: `host-${lifecycleStatus}`,
    kind: 'windows-endpoint',
    lifecycleStatus,
    configPath: 'aws-lab',
    provider: 'aws',
    vmId: null,
    providerResourceId: null,
    terraformStatePath: null,
    outputs: null,
    lastJobId: null,
    powerState: null,
    powerStateCheckedAt: null,
    updatedAt: '2026-06-22T01:00:00.000Z',
  };
}

describe('provisioning resource visibility helpers', () => {
  it('treats destroyed resources as history, not active inventory', () => {
    expect(isActiveProvisioningResource(resource('ready'))).toBe(true);
    expect(isActiveProvisioningResource(resource('terraform_destroying'))).toBe(true);
    expect(isActiveProvisioningResource(resource('failed'))).toBe(true);
    expect(isActiveProvisioningResource(resource('destroyed'))).toBe(false);
  });

  it('filters destroyed resources out of deployed inventory views', () => {
    const active = resource('ready');
    const destroyed = resource('destroyed');

    expect(activeProvisioningResources([destroyed, active])).toEqual([active]);
  });
});
