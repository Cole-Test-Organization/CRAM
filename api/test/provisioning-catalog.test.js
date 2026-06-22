import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateCatalog } from '../src/services/provisioning/config/validateCatalog.js';

// validateCatalog() with no args validates the real shipped registry; passing a
// Catalog validates that one. Pure — no DB, no running API.

const EMPTY = {
  providerProfiles: [],
  resourceProfiles: [],
  deployments: [],
  appProfiles: [],
  configProfiles: [],
};

const awsLab = { name: 'aws-lab', type: 'aws' };
const winProfile = { name: 'aws-windows-endpoint', provider: 'aws', kind: 'windows-endpoint', terraform: { stack: 's', vars: {} } };

describe('Provisioning — config catalog validation', () => {
  it('the shipped catalog has no shape or reference problems', async () => {
    await assert.doesNotReject(validateCatalog());
  });

  it('flags a deployment referencing a missing terraform resource profile', async () => {
    const catalog = {
      ...EMPTY,
      providerProfiles: [awsLab],
      // aws is a Terraform provider (it has a profile), but not the windows one.
      resourceProfiles: [{ name: 'aws-anchor', provider: 'aws', kind: 'anchor', terraform: { stack: 's', vars: {} } }],
      deployments: [
        {
          name: 'd',
          providerProfile: 'aws-lab',
          resources: [{ kind: 'windows-endpoint', hostname: 'w1', placement: { provider: 'aws' } }],
        },
      ],
    };
    await assert.rejects(
      validateCatalog(catalog),
      /terraform resource profile "aws-windows-endpoint" not found/,
    );
  });

  it('flags an app-profile option value that names no app profile', async () => {
    const catalog = {
      ...EMPTY,
      providerProfiles: [awsLab],
      resourceProfiles: [winProfile],
      deployments: [
        {
          name: 'd',
          providerProfile: 'aws-lab',
          inputs: [{ name: 'p', type: 'string', appProfileGroup: 'windows', options: [{ value: 'ghost' }] }],
          resources: [{ kind: 'windows-endpoint', hostname: 'w1', placement: {} }],
        },
      ],
    };
    await assert.rejects(validateCatalog(catalog), /option "ghost" names no windows app profile/);
  });

  it('flags a resource.appProfiles entry that does not resolve in its kind group', async () => {
    const catalog = {
      ...EMPTY,
      providerProfiles: [awsLab],
      resourceProfiles: [winProfile],
      deployments: [
        {
          name: 'd',
          providerProfile: 'aws-lab',
          resources: [{ kind: 'windows-endpoint', hostname: 'w1', placement: {}, appProfiles: ['nonexistent'] }],
        },
      ],
    };
    await assert.rejects(
      validateCatalog(catalog),
      /app profile "nonexistent" not found in group "windows"/,
    );
  });

  it('flags a malformed module (Zod shape)', async () => {
    const catalog = { ...EMPTY, providerProfiles: [{ name: '', type: 'aws' }] };
    await assert.rejects(validateCatalog(catalog), /provider profile/);
  });
});
