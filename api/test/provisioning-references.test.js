import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateDeploymentReferences } from '../src/services/provisioning/config/validateReferences.js';

// Pure unit test: validateDeploymentReferences takes a narrow ReferenceConfigSource
// (getProviderProfile + getResourceProfile), so we feed it in-memory maps — no DB,
// no running API. Catches the references the broker otherwise resolves mid-deploy.

function source({ providerProfiles = {}, resourceProfiles = {} } = {}) {
  return {
    async getProviderProfile(name) {
      return providerProfiles[name] ?? null;
    },
    async getResourceProfile(name) {
      return resourceProfiles[name] ?? null;
    },
  };
}

function tfProfile(name, provider, kind, vars = {}) {
  return { name, provider, kind, terraform: { stack: `terraform/${name}`, vars } };
}

describe('Provisioning — deployment reference preflight', () => {
  it('passes a deployment whose references all resolve', async () => {
    const deployment = {
      name: 'aws-pair',
      provider: { type: 'aws' },
      providerProfile: 'aws-lab',
      resources: [
        { kind: 'panw-vmseries', hostname: 'fw-1' },
        {
          kind: 'egress-route',
          hostname: 'egress',
          // references fw-1's output — fw-1 exists in this deployment, so it's valid
          terraformProfile: 'aws-egress-route',
        },
      ],
      steps: [
        { name: 'firewall', action: 'up', targets: ['fw-1'] },
        { name: 'route', action: 'up', targets: ['egress'] },
      ],
    };
    const config = source({
      providerProfiles: { 'aws-lab': { type: 'aws' } },
      resourceProfiles: {
        'aws-panw-vmseries': tfProfile('aws-panw-vmseries', 'aws', 'panw-vmseries'),
        'aws-egress-route': tfProfile('aws-egress-route', 'aws', 'egress-route', {
          peer_id: { fromResource: 'fw-1', output: 'instance_id' },
        }),
      },
    });

    await assert.doesNotReject(validateDeploymentReferences(deployment, config));
  });

  it('falls back to ${provider}-${kind} when terraformProfile is unset, and flags a missing one', async () => {
    const deployment = {
      name: 'aws-win',
      provider: { type: 'aws' },
      resources: [{ kind: 'windows-endpoint', hostname: 'win-1' }],
    };
    // No resourceProfiles seeded → the derived name "aws-windows-endpoint" is missing.
    await assert.rejects(
      validateDeploymentReferences(deployment, source()),
      /terraform resource profile "aws-windows-endpoint" not found/,
    );
  });

  it('flags a provider/kind mismatch on the resolved profile', async () => {
    const deployment = {
      name: 'mix',
      provider: { type: 'aws' },
      resources: [{ kind: 'windows-endpoint', hostname: 'w', terraformProfile: 'wrong' }],
    };
    const config = source({
      resourceProfiles: { wrong: tfProfile('wrong', 'proxmox', 'panw-vmseries') },
    });
    await assert.rejects(validateDeploymentReferences(deployment, config), (err) => {
      assert.match(err.message, /is for provider proxmox, not aws/);
      assert.match(err.message, /is for resource kind panw-vmseries, not windows-endpoint/);
      return true;
    });
  });

  it('flags a step target that matches no resource', async () => {
    const deployment = {
      name: 'dep',
      provider: { type: 'aws' },
      resources: [{ kind: 'windows-endpoint', hostname: 'win-1', terraformProfile: 'p' }],
      steps: [{ name: 'bad', action: 'up', targets: ['does-not-exist'] }],
    };
    const config = source({ resourceProfiles: { p: tfProfile('p', 'aws', 'windows-endpoint') } });
    await assert.rejects(
      validateDeploymentReferences(deployment, config),
      /step "bad": target "does-not-exist" matches no resource/,
    );
  });

  it('flags a dangling fromResource reference (incl. nested first candidates)', async () => {
    const deployment = {
      name: 'dep',
      provider: { type: 'aws' },
      resources: [{ kind: 'egress-route', hostname: 'egress', terraformProfile: 'aws-egress-route' }],
    };
    const config = source({
      resourceProfiles: {
        'aws-egress-route': tfProfile('aws-egress-route', 'aws', 'egress-route', {
          peer_id: { first: [{ fromResource: 'ghost-fw', output: 'instance_id' }] },
        }),
      },
    });
    await assert.rejects(
      validateDeploymentReferences(deployment, config),
      /references resource "ghost-fw" via fromResource/,
    );
  });

  it('aggregates every problem into one error', async () => {
    const deployment = {
      name: 'broken',
      provider: { type: 'aws' },
      providerProfile: 'missing-provider',
      resources: [
        { kind: 'windows-endpoint', hostname: 'w1' }, // missing aws-windows-endpoint profile
        { kind: 'ubuntu-server', hostname: 'u1' }, // missing aws-ubuntu-server profile
      ],
      steps: [{ name: 's', action: 'up', targets: ['nope'] }],
    };
    await assert.rejects(validateDeploymentReferences(deployment, source()), (err) => {
      // provider profile + 2 terraform profiles + 1 step target = 4 problems
      assert.match(err.message, /has 4 unresolved references/);
      assert.match(err.message, /provider profile "missing-provider" not found/);
      assert.match(err.message, /target "nope"/);
      return true;
    });
  });
});
