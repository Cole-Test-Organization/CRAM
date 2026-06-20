import { createSignal, onCleanup } from 'solid-js';
import { api, type ProvisioningJob, type ProvisioningJobStatus, type ProvisioningResource } from './api';

export type ProvisioningStreamStatus = 'connecting' | 'live' | 'reconnecting' | 'polling' | 'closed';

export type ProvisioningEventSnapshot = {
  activeJobId: string | null;
  resources: ProvisioningResource[];
  jobs: ProvisioningJob[];
};

export type ProvisioningEventEnvelope =
  | { type: 'snapshot'; ts: string; data: ProvisioningEventSnapshot }
  | { type: 'state'; ts: string; data: { activeJobId: string | null; resources: ProvisioningResource[] } }
  | { type: 'resource'; ts: string; data: ProvisioningResource }
  | { type: 'active-job'; ts: string; data: { activeJobId: string | null } }
  | { type: 'job'; ts: string; data: ProvisioningJob }
  | { type: 'error'; ts: string; data: { message?: string } };

export type ProvisioningEventState = {
  activeJobId: string | null;
  resources: ProvisioningResource[];
  jobs: ProvisioningJob[];
};

type ProvisioningEventsApi = Pick<typeof api, 'listProvisioningResources' | 'listProvisioningJobs'>;
type EventSourceFactory = new (url: string) => EventSource;

type StreamOptions = {
  apiClient?: ProvisioningEventsApi;
  autoFetch?: boolean;
  eventSourceFactory?: EventSourceFactory | null;
  jobsLimit?: number;
  pollMs?: number;
  url?: string;
};

const streamUrl = '/api/provisioning/events';

function jobStamp(job: ProvisioningJob): string {
  return job.createdAt || job.startedAt || job.finishedAt || '';
}

function sortJobs(jobs: ProvisioningJob[]): ProvisioningJob[] {
  return [...jobs].sort((a, b) => jobStamp(b).localeCompare(jobStamp(a)));
}

function mergeNullable<T>(next: T | null | undefined, current: T | null | undefined): T | null {
  return next === null || next === undefined ? (current ?? null) : next;
}

export function mergeProvisioningJob(
  current: ProvisioningJob | undefined,
  incoming: ProvisioningJob,
): ProvisioningJob {
  if (!current) return incoming;
  return {
    ...current,
    ...incoming,
    target: mergeNullable(incoming.target, current.target),
    deployment: mergeNullable(incoming.deployment, current.deployment),
    resourceAction: mergeNullable(incoming.resourceAction, current.resourceAction),
    params: mergeNullable(incoming.params, current.params),
    createdAt: mergeNullable(incoming.createdAt, current.createdAt),
    logs: incoming.logs ?? current.logs,
  };
}

export function upsertProvisioningJob(jobs: ProvisioningJob[], incoming: ProvisioningJob): ProvisioningJob[] {
  const index = jobs.findIndex((job) => job.id === incoming.id);
  if (index === -1) return sortJobs([incoming, ...jobs]);
  const next = [...jobs];
  next[index] = mergeProvisioningJob(next[index], incoming);
  return sortJobs(next);
}

export function upsertProvisioningResource(
  resources: ProvisioningResource[],
  incoming: ProvisioningResource,
): ProvisioningResource[] {
  const index = resources.findIndex((resource) => resource.id === incoming.id);
  if (index === -1) return [...resources, incoming];
  const next = [...resources];
  next[index] = incoming;
  return next;
}

export function applyProvisioningEvent(
  state: ProvisioningEventState,
  envelope: ProvisioningEventEnvelope,
): ProvisioningEventState {
  switch (envelope.type) {
    case 'snapshot':
      return {
        activeJobId: envelope.data.activeJobId,
        resources: envelope.data.resources,
        jobs: sortJobs(envelope.data.jobs),
      };
    case 'state':
      return {
        ...state,
        activeJobId: envelope.data.activeJobId,
        resources: envelope.data.resources,
      };
    case 'resource':
      return {
        ...state,
        resources: upsertProvisioningResource(state.resources, envelope.data),
      };
    case 'active-job':
      return { ...state, activeJobId: envelope.data.activeJobId };
    case 'job':
      return { ...state, jobs: upsertProvisioningJob(state.jobs, envelope.data) };
    case 'error':
      return state;
  }
}

function eventSourceCtor(options: StreamOptions): EventSourceFactory | null {
  if (options.eventSourceFactory !== undefined) return options.eventSourceFactory;
  return typeof EventSource === 'undefined' ? null : EventSource;
}

function eventSourceClosed(source: EventSource): boolean {
  return source.readyState === 2;
}

export function createProvisioningEventStream(options: StreamOptions = {}) {
  const client = options.apiClient ?? api;
  const autoFetch = options.autoFetch !== false;
  const jobsLimit = options.jobsLimit ?? 50;
  const pollMs = options.pollMs ?? 5000;
  const [state, setState] = createSignal<ProvisioningEventState>({
    activeJobId: null,
    resources: [],
    jobs: [],
  });
  const [status, setStatus] = createSignal<ProvisioningStreamStatus>('connecting');
  const [error, setError] = createSignal('');
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let source: EventSource | null = null;

  const refresh = async () => {
    try {
      const [resources, jobs] = await Promise.all([
        client.listProvisioningResources(),
        client.listProvisioningJobs({ limit: jobsLimit }),
      ]);
      setState((current) => ({ ...current, resources, jobs: sortJobs(jobs) }));
      setError('');
    } catch (err: any) {
      setError(err?.message || 'Failed to refresh broker state');
    }
  };

  const applyEnvelope = (envelope: ProvisioningEventEnvelope) => {
    if (envelope.type === 'error') {
      setError(envelope.data.message || 'Broker event stream error');
      return;
    }
    setStatus('live');
    setError('');
    setState((current) => applyProvisioningEvent(current, envelope));
  };

  const upsertJob = (job: ProvisioningJob) => {
    setState((current) => ({ ...current, jobs: upsertProvisioningJob(current.jobs, job) }));
  };

  const upsertResource = (resource: ProvisioningResource) => {
    setState((current) => ({
      ...current,
      resources: upsertProvisioningResource(current.resources, resource),
    }));
  };

  const startPolling = () => {
    if (pollTimer) return;
    setStatus('polling');
    if (autoFetch) {
      void refresh();
      pollTimer = setInterval(() => void refresh(), pollMs);
    }
  };

  const Source = eventSourceCtor(options);
  if (Source) {
    source = new Source(options.url ?? streamUrl);
    source.onopen = () => {
      setStatus('live');
      setError('');
    };
    source.onmessage = (message) => {
      try {
        applyEnvelope(JSON.parse(message.data) as ProvisioningEventEnvelope);
      } catch {
        setError('Failed to parse broker event');
      }
    };
    source.onerror = () => {
      setStatus(source && eventSourceClosed(source) ? 'closed' : 'reconnecting');
      if (autoFetch) void refresh();
    };
  } else {
    startPolling();
  }

  onCleanup(() => {
    if (pollTimer) clearInterval(pollTimer);
    source?.close();
  });

  return {
    activeJobId: () => state().activeJobId,
    connectionStatus: status,
    error,
    jobById: (id: string | null | undefined) => state().jobs.find((job) => job.id === id) ?? null,
    jobs: () => state().jobs,
    refresh,
    resources: () => state().resources,
    setActiveJobId: (activeJobId: string | null) => setState((current) => ({ ...current, activeJobId })),
    status,
    upsertJob,
    upsertResource,
  };
}

export function isTerminalProvisioningStatus(status: ProvisioningJobStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'canceled';
}
