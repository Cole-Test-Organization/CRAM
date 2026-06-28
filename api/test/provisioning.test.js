import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, get, post } from './helpers.js';

async function readFirstSseEnvelope(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${BASE}${path}`, { signal: controller.signal });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/event-stream/);

    const reader = res.body.getReader();
    let text = '';
    while (!text.includes('\n\n')) {
      const { done, value } = await reader.read();
      if (done) break;
      text += Buffer.from(value).toString('utf8');
    }
    await reader.cancel();
    const block = text.split('\n\n')[0];
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trim())
      .join('\n');
    return JSON.parse(data);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

describe('Provisioning — discovery and safe enqueue validation', () => {
  it('lists seeded deployments and exposes a full descriptor', async () => {
    const list = await get('/provisioning/deployments');
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.body));
    assert.ok(list.body.length >= 9);

    const gpLab = list.body.find((d) => d.id === 'aws-gp-lab-trusted-users');
    assert.ok(gpLab);
    assert.equal(gpLab.deployable, true);
    assert.ok(gpLab.resourceCount > 0);

    const detail = await get('/provisioning/deployments/aws-gp-lab-trusted-users');
    assert.equal(detail.status, 200);
    assert.equal(detail.body.id, 'aws-gp-lab-trusted-users');
    assert.ok(Array.isArray(detail.body.resources));
    assert.ok(Array.isArray(detail.body.steps));
    // requiredEnv lists real stored secrets only — infra/machine-sourced env vars
    // (AWS profile, the auto-detected source CIDR, the local SSH public key) carry
    // their own defaults/resolvers and must not be surfaced as missing secrets.
    for (const infraEnv of ['AWS_PROFILE', 'AWS_GP_LAB_ALLOWED_SOURCE_CIDRS', 'AWS_GP_LAB_SSH_PUBLIC_KEY']) {
      assert.ok(!detail.body.requiredEnv.includes(infraEnv), `${infraEnv} must not be a required secret`);
    }
    // Mandatory secrets: licensing auth, the device-cert pins the firewalls need to
    // auto-register and pull licenses, and the Windows admin password.
    for (const required of [
      'PANW_PANORAMA_AUTH_CODE',
      'PANW_DEVICE_CERT_PIN_ID',
      'PANW_DEVICE_CERT_PIN_VALUE',
      'PANW_LICENSE_DEACTIVATION_API_KEY',
      'WINDOWS_ENDPOINT_ADMIN_PASSWORD',
    ]) {
      assert.ok(detail.body.requiredEnv.includes(required), `${required} must be a required secret`);
    }
  });

  it('lists resources, jobs, and secret summaries without exposing secret values', async () => {
    const resources = await get('/provisioning/resources');
    assert.equal(resources.status, 200);
    assert.ok(Array.isArray(resources.body));

    const jobs = await get('/provisioning/jobs');
    assert.equal(jobs.status, 200);
    assert.ok(Array.isArray(jobs.body));

    const secrets = await get('/provisioning/secrets');
    assert.equal(secrets.status, 200);
    assert.ok(Array.isArray(secrets.body));
    for (const secret of secrets.body) {
      assert.equal(typeof secret.name, 'string');
      assert.equal('value' in secret, false);
      assert.equal('secret' in secret, false);
      assert.equal('secretValue' in secret, false);
    }
  });

  it('streams a snapshot as the first provisioning SSE event', async () => {
    const event = await readFirstSseEnvelope('/provisioning/events');
    assert.equal(event.type, 'snapshot');
    assert.match(event.ts, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(event.data.activeJobId === null || typeof event.data.activeJobId === 'string');
    assert.ok(Array.isArray(event.data.resources));
    assert.ok(Array.isArray(event.data.jobs));
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
