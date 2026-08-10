import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { VmSeriesResourceAdapter } from '../src/services/provisioning/resources/palo/vm-series/vmSeriesResourceAdapter.js';
import { PanosApiClient } from '../src/services/provisioning/resources/palo/shared/client.js';

const outputs = {
  vm_id: 804,
  firewall: { management_ip: '10.0.20.5' },
};

function fixture() {
  const resource = {
    kind: 'panw-vmseries',
    name: 'fw-lab-02',
    hostname: 'fw-lab-02',
    vm: { cpuCores: 4, memoryMb: 8192, cpuType: 'host', started: true },
    management: {
      type: 'static',
      ipAddress: '10.0.20.5',
      netmask: '255.255.255.0',
      defaultGateway: '10.0.20.1',
    },
    license: {
      authCode: 'test-auth-code',
      deactivationApiKey: 'test-deactivation-key',
    },
    managementServer: { mode: 'none' },
    bootstrap: { adminPassword: 'test-admin-password' },
    placement: {
      provider: 'proxmox',
      templateVmId: 800,
      vmId: 804,
      interfaces: [{ name: 'mgmt', bridge: 'vmbr0', model: 'virtio', vlanId: 20 }],
    },
  };
  const deployment = {
    name: 'proxmox-fw-lab-test',
    provider: {
      type: 'proxmox',
      endpointEnv: 'PROXMOX_VE_ENDPOINT',
      apiTokenEnv: 'PROXMOX_VE_API_TOKEN',
      defaultTargetNode: 'proxmox',
      defaultTemplateNode: 'proxmox',
      defaultVmDatastoreId: 'local-lvm',
      defaultIsoDatastoreId: 'local',
    },
    resources: [resource],
  };
  const record = {
    id: 'resource-1',
    deploymentId: deployment.name,
    hostname: resource.hostname,
    kind: resource.kind,
    lifecycleStatus: 'ready',
    configPath: deployment.name,
    provider: 'proxmox',
    authCode: 'test-auth-code',
    outputs,
    updatedAt: '2026-08-03T00:00:00.000Z',
  };
  return { resource, deployment, record };
}

function contextFor(deployment, resource, overrides = {}) {
  return {
    configPath: deployment.name,
    configLoader: {},
    stateRepository: {
      async patchResource() {},
    },
    deployment,
    resource,
    provider: { type: 'proxmox', requiresBootstrapIso: true },
    terraform: {
      async readOutputs() {
        throw new Error('generic Terraform output reader must not run for persisted Proxmox outputs');
      },
    },
    ...overrides,
  };
}

describe('Provisioning — shared VM-Series lifecycle on Proxmox', () => {
  it('installs the documented licensing API key and treats the expected reboot disconnect as unacknowledged', async () => {
    const client = new PanosApiClient({ host: 'firewall.test' });
    client.setApiKey('test-api-key');
    let receivedCommand = null;
    let receivedOptions = null;
    client.op = async (command, options) => {
      receivedCommand = command;
      receivedOptions = options;
      return '';
    };

    assert.equal(await client.setLicenseDeactivationApiKey('license-api-key'), false);
    assert.equal(
      receivedCommand,
      '<request><license><api-key><set><key>license-api-key</key></set></api-key></license></request>',
    );
    assert.deepEqual(receivedOptions, { ignoreDisconnect: true });
  });

  it('uses the documented VM-Capacity auto-deactivation command and does not treat a disconnect as acknowledgment', async () => {
    const client = new PanosApiClient({ host: 'firewall.test' });
    client.setApiKey('test-api-key');
    let receivedCommand = null;
    let receivedOptions = null;
    client.op = async (command, options) => {
      receivedCommand = command;
      receivedOptions = options;
      return '';
    };

    const result = await client.deactivateVmSeriesLicense();

    assert.equal(
      receivedCommand,
      '<request><license><deactivate><VM-Capacity><mode>auto</mode></VM-Capacity></deactivate></license></request>',
    );
    assert.deepEqual(receivedOptions, { ignoreDisconnect: true });
    assert.deepEqual(result, { acknowledged: false, jobId: null });
  });

  it('requires a successful PAN-OS response before synchronous deactivation is acknowledged', async () => {
    const client = new PanosApiClient({ host: 'firewall.test' });
    client.setApiKey('test-api-key');
    client.op = async () => '<response status="success"><result>License deactivated</result></response>';

    assert.deepEqual(
      await client.deactivateVmSeriesLicense(),
      { acknowledged: true, jobId: null },
    );
  });

  it('uses persisted Proxmox outputs for the shared bootstrap/license action', async () => {
    const { deployment, resource, record } = fixture();
    let receivedOutputs = null;
    let receivedAuthCode = null;
    const bootstrap = {
      async bootstrapFirewall(_resource, actionOutputs, authCode) {
        receivedOutputs = actionOutputs;
        receivedAuthCode = authCode;
        return {
          managementAddress: '10.0.20.5',
          vmLicense: 'VM-FLEX',
          serial: '007200000001',
          scmFolder: null,
          scmConnected: null,
        };
      },
    };
    const adapter = new VmSeriesResourceAdapter(bootstrap, {}, {
      async apply() {
        throw new Error('not used');
      },
      async destroy() {
        throw new Error('not used');
      },
    });

    const patch = await adapter.runAction(
      contextFor(deployment, resource),
      record,
      { action: 'bootstrap', targets: [resource.hostname] },
      () => {},
    );

    assert.equal(receivedOutputs, outputs);
    assert.equal(receivedAuthCode, 'test-auth-code');
    assert.equal(patch.serial, '007200000001');
    assert.equal(patch.panos.vmLicense, 'VM-FLEX');
  });

  it('deactivates the license before destroying the Proxmox VM', async () => {
    const { deployment, resource, record } = fixture();
    const order = [];
    const bootstrap = {
      async deactivateFirewallLicense(_resource, actionOutputs) {
        assert.equal(actionOutputs, outputs);
        order.push('deactivate');
        return { deactivated: true, serial: '007200000001' };
      },
    };
    const adapter = new VmSeriesResourceAdapter(bootstrap, {}, {
      async apply() {
        throw new Error('not used');
      },
      async destroy() {
        order.push('destroy');
      },
    });

    await adapter.down(contextFor(deployment, resource), record, () => {});

    assert.deepEqual(order, ['deactivate', 'destroy']);
  });

  it('refuses to destroy the Proxmox VM when deactivation is not confirmed', async () => {
    const { deployment, resource, record } = fixture();
    let destroyCalled = false;
    const bootstrap = {
      async deactivateFirewallLicense() {
        return { deactivated: false, reason: 'license server unavailable' };
      },
    };
    const adapter = new VmSeriesResourceAdapter(bootstrap, {}, {
      async apply() {
        throw new Error('not used');
      },
      async destroy() {
        destroyCalled = true;
      },
    });

    await assert.rejects(
      adapter.down(contextFor(deployment, resource), record, () => {}),
      /Refusing to destroy fw-lab-02 without de-licensing: license server unavailable/,
    );
    assert.equal(destroyCalled, false);
  });
});
