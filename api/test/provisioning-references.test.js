import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateDeploymentReferences } from '../src/services/provisioning/config/validateReferences.js';

// Pure unit test: validateDeploymentReferences takes a narrow ReferenceConfigSource
// (getProviderProfile + getResourceProfile + listResourceProfileProviders), so we feed
// it in-memory maps — no DB, no running API. listResourceProfileProviders is derived
// from the resourceProfiles map: a provider counts as "uses Terraform" iff it has a
// resource profile, which gates whether derived ${provider}-${kind} profiles are required.

function source({ providerProfiles = {}, resourceProfiles = {} } = {}) {
  return {
    async getProviderProfile(name) {
      return providerProfiles[name] ?? null;
    },
    async getResourceProfile(name) {
      return resourceProfiles[name] ?? null;
    },
    async listResourceProfileProviders() {
      return [...new Set(Object.values(resourceProfiles).map((p) => p.provider))];
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
        { kind: 'egress-route', hostname: 'egress', terraformProfile: 'aws-egress-route' },
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
    // aws is a Terraform provider (it has a profile), but not the windows one → the
    // derived "aws-windows-endpoint" is required and missing.
    const config = source({ resourceProfiles: { 'aws-anchor': tfProfile('aws-anchor', 'aws', 'anchor') } });
    await assert.rejects(
      validateDeploymentReferences(deployment, config),
      /terraform resource profile "aws-windows-endpoint" not found/,
    );
  });

  it('does not require a derived terraform profile for a provider that uses none (e.g. proxmox)', async () => {
    const deployment = {
      name: 'pmx-fw',
      provider: { type: 'proxmox' },
      providerProfile: 'proxmox-home',
      resources: [{ kind: 'panw-vmseries', hostname: 'fw' }],
      steps: [{ name: 'fw', action: 'up', targets: ['fw'] }],
    };
    // Only aws has resource profiles → proxmox provisions another way, so the derived
    // "proxmox-panw-vmseries" is NOT expected. (Regression guard for proxmox-fw-lab.)
    const config = source({
      providerProfiles: { 'proxmox-home': { type: 'proxmox' } },
      resourceProfiles: { 'aws-anchor': tfProfile('aws-anchor', 'aws', 'anchor') },
    });
    await assert.doesNotReject(validateDeploymentReferences(deployment, config));
  });

  it('still flags an EXPLICIT terraformProfile on a non-terraform provider when it is missing', async () => {
    const deployment = {
      name: 'pmx-bad',
      provider: { type: 'proxmox' },
      resources: [{ kind: 'panw-vmseries', hostname: 'fw', terraformProfile: 'does-not-exist' }],
    };
    await assert.rejects(
      validateDeploymentReferences(deployment, source()),
      /terraform resource profile "does-not-exist" not found/,
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
    // aws anchored as a Terraform provider so both derived profiles are required.
    const config = source({ resourceProfiles: { 'aws-anchor': tfProfile('aws-anchor', 'aws', 'anchor') } });
    await assert.rejects(validateDeploymentReferences(deployment, config), (err) => {
      // provider profile + 2 terraform profiles + 1 step target = 4 problems
      assert.match(err.message, /has 4 unresolved references/);
      assert.match(err.message, /provider profile "missing-provider" not found/);
      assert.match(err.message, /target "nope"/);
      return true;
    });
  });
});
