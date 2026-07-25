import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileResources } from '../src/services/provisioning/reconcile.js';

// Pure — no DB, no API, no cloud CLI. Fake provider adapters stand in for the real
// registry via deps.getAdapter, so this pins the behavior that matters: an expired
// login must never be reported (or acted on) as "the machine is gone".

function record(overrides = {}) {
  return {
    id: 'res_1',
    deploymentId: 'lab',
    name: 'box-1',
    hostname: 'box-1',
    kind: 'ubuntu-server',
    lifecycleStatus: 'ready',
    configPath: 'lab',
    provider: 'aws',
    providerResourceId: 'i-abc',
    powerState: 'running',
    updatedAt: '2026-07-24T00:00:00.000Z',
    ...overrides,
  };
}

function harness({ records = [record()], adapter, profiles = [] }) {
  const patched = [];
  const deps = {
    listResources: async () => records,
    listProviderProfiles: async () => profiles,
    resolveContext: async (r) => ({
      provider: adapter,
      context: {
        configPath: r.configPath,
        configLoader: {},
        stateRepository: {},
        deployment: { name: r.deploymentId, provider: { type: 'aws', region: 'us-west-2' }, resources: [] },
        resource: { kind: r.kind, hostname: r.hostname, placement: {} },
      },
    }),
    patchResource: async (id, patch) => {
      patched.push({ id, patch });
      return { ...records.find((r) => r.id === id), ...patch };
    },
    getAdapter: () => adapter,
  };
  return { deps, patched };
}

const okCredentials = { state: 'ok', identity: 'arn:aws:iam::123:role/lab' };

function fakeAdapter({ credentials = okCredentials, existence, calls = {} }) {
  return {
    type: 'aws',
    credentialScope: () => 'aws:us-west-2:lab',
    checkCredentials: async () => {
      calls.credentials = (calls.credentials ?? 0) + 1;
      return credentials;
    },
    describeResource: async () => {
      calls.describe = (calls.describe ?? 0) + 1;
      return existence;
    },
  };
}

describe('Provisioning — reconciliation', () => {
  it('reports a vanished resource as stale and marks it destroyed when applying', async () => {
    const adapter = fakeAdapter({ existence: { presence: 'missing', detail: 'EC2 instance is terminated' } });
    const { deps, patched } = harness({ adapter });

    const dryRun = await reconcileResources(deps, {});
    assert.equal(dryRun.applied, false);
    assert.equal(dryRun.resources[0].status, 'missing');
    assert.equal(dryRun.resources[0].stale, true);
    assert.equal(dryRun.resources[0].lifecycleStatus, 'ready', 'a dry run must not change state');
    assert.equal(dryRun.summary.markedDestroyed, 0);
    assert.equal(patched.length, 0, 'a dry run must not write');

    const applied = await reconcileResources(deps, { apply: true });
    assert.equal(applied.resources[0].applied, true);
    assert.equal(applied.resources[0].lifecycleStatus, 'destroyed');
    assert.equal(applied.summary.markedDestroyed, 1);
    assert.equal(patched.length, 1);
    assert.equal(patched[0].patch.lifecycleStatus, 'destroyed');
    assert.equal(patched[0].patch.powerState, 'terminated');
  });

  it('never treats expired credentials as a missing resource, even with apply', async () => {
    const adapter = fakeAdapter({
      credentials: { state: 'expired', detail: 'ExpiredToken', remediation: 'aws sso login' },
      existence: { presence: 'missing' },
    });
    const { deps, patched } = harness({ adapter });

    const report = await reconcileResources(deps, { apply: true });
    assert.equal(report.resources[0].status, 'credentials-invalid');
    assert.equal(report.resources[0].stale, false);
    assert.equal(report.resources[0].lifecycleStatus, 'ready');
    assert.equal(report.summary.missing, 0);
    assert.equal(report.summary.credentialsInvalid, 1);
    assert.equal(patched.length, 0, 'nothing may be written under bad credentials');
    assert.equal(report.credentials[0].state, 'expired');
    assert.equal(report.credentials[0].remediation, 'aws sso login');
  });

  it('treats a per-resource auth failure as a credentials problem, not a deletion', async () => {
    const adapter = fakeAdapter({
      existence: { presence: 'unknown', detail: 'AccessDenied', credentialFailure: true },
    });
    const { deps, patched } = harness({ adapter });

    const report = await reconcileResources(deps, { apply: true });
    assert.equal(report.resources[0].status, 'credentials-invalid');
    assert.equal(report.summary.missing, 0);
    assert.equal(patched.length, 0);
  });

  it('refreshes power state for resources that are still present', async () => {
    const adapter = fakeAdapter({ existence: { presence: 'present', powerState: 'stopped' } });
    const { deps, patched } = harness({ adapter });

    const report = await reconcileResources(deps, { apply: true });
    assert.equal(report.resources[0].status, 'present');
    assert.equal(report.resources[0].powerState, 'stopped');
    assert.equal(report.resources[0].previousPowerState, 'running');
    assert.equal(patched.length, 1);
    assert.equal(patched[0].patch.powerState, 'stopped');
    assert.equal(patched[0].patch.lifecycleStatus, undefined, 'a present resource keeps its lifecycle status');
  });

  it('checks credentials once per scope, not once per resource', async () => {
    const calls = {};
    const adapter = fakeAdapter({ existence: { presence: 'present' }, calls });
    const { deps } = harness({
      adapter,
      records: [record(), record({ id: 'res_2', hostname: 'box-2' })],
      profiles: [{ name: 'aws-lab', provider: { type: 'aws', region: 'us-west-2' } }],
    });

    const report = await reconcileResources(deps, {});
    assert.equal(calls.credentials, 1, 'one probe for the shared credential scope');
    assert.equal(calls.describe, 2, 'but every resource is probed');
    assert.equal(report.credentials.length, 1);
    assert.deepEqual(report.credentials[0].providerProfiles, ['aws-lab']);
  });

  it('skips destroyed records by default and can filter to one deployment', async () => {
    const adapter = fakeAdapter({ existence: { presence: 'present' } });
    const { deps } = harness({
      adapter,
      records: [
        record(),
        record({ id: 'res_2', hostname: 'box-2', lifecycleStatus: 'destroyed' }),
        record({ id: 'res_3', hostname: 'box-3', deploymentId: 'other' }),
      ],
    });

    const defaults = await reconcileResources(deps, {});
    assert.deepEqual(defaults.resources.map((r) => r.hostname), ['box-1', 'box-3']);

    const withDestroyed = await reconcileResources(deps, { includeDestroyed: true });
    assert.equal(withDestroyed.resources.length, 3);

    const scoped = await reconcileResources(deps, { deployment: 'lab' });
    assert.deepEqual(scoped.resources.map((r) => r.hostname), ['box-1']);
  });

  it('surfaces an adapter that cannot verify existence as unsupported, not missing', async () => {
    const adapter = { type: 'aws', credentialScope: () => 'aws:lab', checkCredentials: async () => okCredentials };
    const { deps, patched } = harness({ adapter });

    const report = await reconcileResources(deps, { apply: true });
    assert.equal(report.resources[0].status, 'unsupported');
    assert.equal(report.summary.missing, 0);
    assert.equal(patched.length, 0);
  });

  it('does not let a throwing credential probe read as a verdict on the infrastructure', async () => {
    const adapter = {
      type: 'aws',
      credentialScope: () => 'aws:lab',
      checkCredentials: async () => { throw new Error('gcloud: command not found'); },
      describeResource: async () => ({ presence: 'missing' }),
    };
    const { deps, patched } = harness({ adapter });

    const report = await reconcileResources(deps, { apply: true });
    assert.equal(report.credentials[0].state, 'error');
    assert.equal(report.resources[0].status, 'credentials-invalid');
    assert.equal(patched.length, 0);
  });
});
