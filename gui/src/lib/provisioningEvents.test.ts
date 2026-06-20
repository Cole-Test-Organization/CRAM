import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { ProvisioningJob, ProvisioningResource } from './api';
import {
  applyProvisioningEvent,
  createProvisioningEventStream,
  mergeProvisioningJob,
  upsertProvisioningResource,
} from './provisioningEvents';

function resource(overrides: Partial<ProvisioningResource> = {}): ProvisioningResource {
  return {
    id: 'res-1',
    deploymentId: 'aws-lab',
    name: 'fw-1',
    hostname: 'fw-1',
    kind: 'panw-vmseries',
    lifecycleStatus: 'terraform_applying',
    configPath: 'aws-lab',
    provider: 'aws',
    vmId: null,
    providerResourceId: null,
    terraformStatePath: null,
    outputs: null,
    lastJobId: null,
    powerState: null,
    powerStateCheckedAt: null,
    updatedAt: '2026-06-19T21:00:00.000Z',
    ...overrides,
  };
}

function job(overrides: Partial<ProvisioningJob> = {}): ProvisioningJob {
  return {
    id: 'job-1',
    action: 'deploy',
    target: null,
    deployment: 'aws-lab',
    resourceAction: null,
    status: 'queued',
    cancelRequested: false,
    params: { includeWindowsEndpoint: false },
    error: null,
    createdAt: '2026-06-19T21:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    logs: [],
    ...overrides,
  };
}

class MockEventSource {
  static instances: MockEventSource[] = [];

  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;
  readyState = 0;
  close = vi.fn(() => {
    this.readyState = 2;
  });

  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }

  open() {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  emit(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
  }
}

const sourceFactory = MockEventSource as unknown as new (url: string) => EventSource;

describe('provisioning event stream helpers', () => {
  it('merges streamed job progress without erasing deployment metadata', () => {
    const current = job({ status: 'queued', logs: ['queued'] });
    const incoming = job({
      createdAt: null,
      deployment: null,
      logs: ['running'],
      params: null,
      startedAt: '2026-06-19T21:00:05.000Z',
      status: 'running',
      target: null,
    });

    const merged = mergeProvisioningJob(current, incoming);

    expect(merged.status).toBe('running');
    expect(merged.deployment).toBe('aws-lab');
    expect(merged.createdAt).toBe('2026-06-19T21:00:00.000Z');
    expect(merged.params).toEqual({ includeWindowsEndpoint: false });
    expect(merged.logs).toEqual(['running']);
  });

  it('applies snapshot, resource, and job events to visible state', () => {
    const snapshot = applyProvisioningEvent(
      { activeJobId: null, resources: [], jobs: [] },
      {
        type: 'snapshot',
        ts: '2026-06-19T21:00:00.000Z',
        data: {
          activeJobId: 'job-1',
          resources: [resource()],
          jobs: [job()],
        },
      },
    );
    const nextResource = upsertProvisioningResource(
      snapshot.resources,
      resource({ lifecycleStatus: 'ready', providerResourceId: 'i-123' }),
    );
    const next = applyProvisioningEvent(
      { ...snapshot, resources: nextResource },
      {
        type: 'job',
        ts: '2026-06-19T21:00:05.000Z',
        data: job({ createdAt: null, deployment: null, status: 'running' }),
      },
    );

    expect(next.activeJobId).toBe('job-1');
    expect(next.resources[0].lifecycleStatus).toBe('ready');
    expect(next.resources[0].providerResourceId).toBe('i-123');
    expect(next.jobs[0].status).toBe('running');
    expect(next.jobs[0].deployment).toBe('aws-lab');
  });
});

describe('createProvisioningEventStream', () => {
  it('opens the SSE stream, applies events, and closes it on cleanup', () => {
    MockEventSource.instances = [];

    createRoot((dispose) => {
      const stream = createProvisioningEventStream({
        autoFetch: false,
        eventSourceFactory: sourceFactory,
      });

      expect(MockEventSource.instances).toHaveLength(1);
      const source = MockEventSource.instances[0];
      expect(source.url).toBe('/api/provisioning/events');
      expect(stream.connectionStatus()).toBe('connecting');

      source.open();
      expect(stream.connectionStatus()).toBe('live');

      source.emit({
        type: 'snapshot',
        ts: '2026-06-19T21:00:00.000Z',
        data: {
          activeJobId: null,
          resources: [resource()],
          jobs: [job()],
        },
      });
      source.emit({
        type: 'job',
        ts: '2026-06-19T21:00:05.000Z',
        data: job({ createdAt: null, deployment: null, logs: ['running'], status: 'running' }),
      });

      expect(stream.resources()).toHaveLength(1);
      expect(stream.jobs()[0].status).toBe('running');
      expect(stream.jobs()[0].deployment).toBe('aws-lab');

      dispose();
      expect(source.close).toHaveBeenCalledOnce();
    });
  });
});
