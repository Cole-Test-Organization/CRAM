import { render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { ProvisioningJob } from '../lib/api';
import { JobMonitor } from './HomelabCommon';

function job(overrides: Partial<ProvisioningJob> = {}): ProvisioningJob {
  return {
    id: 'job-live',
    action: 'deploy',
    target: null,
    deployment: 'aws-lab',
    resourceAction: null,
    status: 'running',
    cancelRequested: false,
    params: null,
    error: null,
    createdAt: '2026-06-19T21:00:00.000Z',
    startedAt: '2026-06-19T21:00:05.000Z',
    finishedAt: null,
    logs: ['terraform apply started'],
    ...overrides,
  };
}

describe('JobMonitor live updates', () => {
  it('renders streamed job status and log updates without waiting for polling', async () => {
    const [liveJob, setLiveJob] = createSignal(job());

    render(() => (
      <JobMonitor
        jobId="job-live"
        liveConnected
        liveJob={liveJob()}
      />
    ));

    expect(screen.getByText('Live')).toBeTruthy();
    expect(screen.getByText('running')).toBeTruthy();
    expect(screen.getByText(/terraform apply started/)).toBeTruthy();

    setLiveJob(job({
      finishedAt: '2026-06-19T21:01:00.000Z',
      logs: ['terraform apply started', 'deployment ready'],
      status: 'succeeded',
    }));

    expect(await screen.findByText('succeeded')).toBeTruthy();
    expect(screen.getByText(/deployment ready/)).toBeTruthy();
  });
});
