import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  READABLE_PROVISIONING_SECRET_NAMES,
  SecretsService,
} from '../src/services/provisioning/secrets/index.js';

class FakeSecretsRepository {
  constructor(rows, values) {
    this.rows = rows;
    this.values = values;
    this.getCalls = [];
  }

  async list() {
    return this.rows;
  }

  async get(_userId, name) {
    this.getCalls.push(name);
    return this.values[name] ?? null;
  }
}

describe('Provisioning readable secret summaries', () => {
  it('returns values only for the dashboard-readable allowlist', async () => {
    assert.deepEqual(READABLE_PROVISIONING_SECRET_NAMES, [
      'PANW_DEVICE_CERT_PIN_ID',
      'PANW_NGFW_AUTH_CODE',
      'PANW_PANORAMA_AUTH_CODE',
      'PANW_PANORAMA_SERIAL',
    ]);

    const repo = new FakeSecretsRepository([
      { name: 'PANW_NGFW_AUTH_CODE', description: null, updatedAt: '2026-06-24T00:00:00.000Z' },
      { name: 'PANW_DEVICE_CERT_PIN_VALUE', description: null, updatedAt: '2026-06-24T00:00:00.000Z' },
      { name: 'PANW_PANORAMA_SERIAL', description: null, updatedAt: '2026-06-24T00:00:00.000Z' },
    ], {
      PANW_NGFW_AUTH_CODE: 'readable-auth-code',
      PANW_DEVICE_CERT_PIN_VALUE: 'hidden-pin-value',
      PANW_PANORAMA_SERIAL: 'readable-serial',
    });

    const service = new SecretsService(repo);
    const summaries = await service.listSecrets(1);
    const byName = Object.fromEntries(summaries.map((secret) => [secret.name, secret]));

    assert.equal(byName.PANW_NGFW_AUTH_CODE.readable, true);
    assert.equal(byName.PANW_NGFW_AUTH_CODE.value, 'readable-auth-code');
    assert.equal(byName.PANW_PANORAMA_SERIAL.readable, true);
    assert.equal(byName.PANW_PANORAMA_SERIAL.value, 'readable-serial');

    assert.equal(byName.PANW_DEVICE_CERT_PIN_VALUE.readable, false);
    assert.equal('value' in byName.PANW_DEVICE_CERT_PIN_VALUE, false);
    assert.deepEqual(repo.getCalls, ['PANW_NGFW_AUTH_CODE', 'PANW_PANORAMA_SERIAL']);
  });
});
