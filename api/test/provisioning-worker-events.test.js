import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProvisioningJobWorker } from '../src/services/provisioning/jobWorker.js';
import { BrokerEventBus } from '../src/services/provisioning/events.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)),
  ]);
}

describe('ProvisioningJobWorker events', () => {
  it('publishes running job progress even when the broker is quiet', async () => {
    const events = new BrokerEventBus();
    let release = () => {};
    const seen = new Promise((resolve) => {
      release = events.subscribe((event) => {
        if (event.type === 'job' && event.job.id === 'job-quiet' && event.job.status === 'running') {
          resolve(event);
        }
      });
    });

    const store = {
      events,
      setActiveJob: async () => {},
      saveJob: async (job) => {
        events.publish({ type: 'job', job });
      },
    };
    const broker = {
      deploy: async () => {
        await sleep(80);
      },
    };
    const worker = new ProvisioningJobWorker({
      userId: 1,
      broker,
      postgresStateRepository: store,
      secretResolver: { hydrateAll: async () => ({}) },
      cancelPollMs: 10000,
      progressEventMs: 10,
    });

    try {
      const run = worker.runJob({
        id: 'job-quiet',
        action: 'deploy',
        hostname: null,
        params: { deploymentRef: 'quiet-deploy' },
        started_at: new Date(),
      });
      const event = await withTimeout(seen, 1000);
      assert.equal(event.job.id, 'job-quiet');
      assert.equal(event.job.status, 'running');
      await run;
    } finally {
      release();
    }
  });
});
