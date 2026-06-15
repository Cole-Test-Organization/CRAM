import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { get, post } from './helpers.js';

describe('Provisioning — discovery and safe enqueue validation', () => {
  it('lists seeded deployments and exposes a full descriptor', async () => {
    const list = await get('/provisioning/deployments');
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.body));
    assert.ok(list.body.length >= 10);

    const gpLab = list.body.find((d) => d.id === 'aws-gp-lab-trusted-users');
    assert.ok(gpLab);
    assert.equal(gpLab.deployable, true);
    assert.ok(gpLab.resourceCount > 0);

    const detail = await get('/provisioning/deployments/aws-gp-lab-trusted-users');
    assert.equal(detail.status, 200);
    assert.equal(detail.body.id, 'aws-gp-lab-trusted-users');
    assert.ok(Array.isArray(detail.body.resources));
    assert.ok(Array.isArray(detail.body.steps));
    assert.ok(detail.body.requiredEnv.includes('PANW_PANORAMA_AUTH_CODE'));
  });

  it('lists resources, jobs, and secret summaries without exposing secret values', async () => {
    const resources = await get('/provisioning/resources');
    assert.equal(resources.status, 200);
    assert.deepEqual(resources.body, []);

    const jobs = await get('/provisioning/jobs');
    assert.equal(jobs.status, 200);
    assert.deepEqual(jobs.body, []);

    const secrets = await get('/provisioning/secrets');
    assert.equal(secrets.status, 200);
    assert.deepEqual(secrets.body, []);
  });

  it('rejects invalid lifecycle enqueue requests before any terraform can run', async () => {
    const deploy = await post('/provisioning/deployments/not-seeded/deploy');
    assert.equal(deploy.status, 400);
    assert.match(deploy.body.error, /not seeded/i);

    const down = await post('/provisioning/resources/missing-host/down');
    assert.equal(down.status, 404);
    assert.match(down.body.error, /no provisioned resource/i);
  });
});
