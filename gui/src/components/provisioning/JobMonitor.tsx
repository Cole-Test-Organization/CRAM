import { createEffect, createSignal, onCleanup, Show, untrack } from 'solid-js';
import Button from '../Button';
import StatusBadge from '../StatusBadge';
import { api, type ProvisioningJob } from '../../lib/api';
import { formatDateTime } from '../../utils/date';

function isActiveJob(job: ProvisioningJob | null | undefined): boolean {
  return job?.status === 'queued' || job?.status === 'running';
}

// Logs are append-only and monotonic, so "more lines wins". This lets a logless
// SSE-snapshot job (the `/events` snapshot omits log lines) get backfilled from the
// DB without a later logless live update clobbering the lines we just loaded.
function withRicherLogs(prev: ProvisioningJob | null, incoming: ProvisioningJob): ProvisioningJob {
  const prevLogs = prev?.logs ?? [];
  const incomingLogs = incoming.logs ?? [];
  return { ...incoming, logs: incomingLogs.length >= prevLogs.length ? incomingLogs : prevLogs };
}

export default function JobMonitor(props: {
  jobId: string | null;
  liveConnected?: boolean;
  liveJob?: ProvisioningJob | null;
  onJobUpdate?: (job: ProvisioningJob) => void;
  onSettled?: () => void;
  onClear?: () => void;
}) {
  const [job, setJob] = createSignal<ProvisioningJob | null>(null);
  const [error, setError] = createSignal('');
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let settledJobId: string | null = null;

  const clearTimer = () => {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  };

  const handleSettled = (next: ProvisioningJob) => {
    if (!isActiveJob(next) && settledJobId !== next.id) {
      settledJobId = next.id;
      props.onSettled?.();
    }
  };

  const fetchJob = async (id: string) => {
    try {
      const next = await api.getProvisioningJob(id);
      setJob((prev) => withRicherLogs(prev, next));
      props.onJobUpdate?.(next);
      setError('');
      if (isActiveJob(next) && !props.liveConnected) {
        pollTimer = setTimeout(() => fetchJob(id), 2000);
      } else {
        handleSettled(next);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load job');
      pollTimer = setTimeout(() => fetchJob(id), 5000);
    }
  };

  createEffect(() => {
    const id = props.jobId;
    clearTimer();
    settledJobId = null;
    setJob(null);
    setError('');
    if (!id) return;
    const live = untrack(() => props.liveJob);
    if (live?.id === id) {
      setJob(live);
      handleSettled(live);
      // The SSE snapshot carries job status but no log lines — backfill them from
      // the DB (which has the full history) so a refresh doesn't show empty logs.
      if (!live.logs?.length) fetchJob(id);
    } else {
      fetchJob(id);
    }
  });

  createEffect(() => {
    const id = props.jobId;
    const live = props.liveJob;
    if (!id || !live || live.id !== id) return;
    clearTimer();
    setJob((prev) => withRicherLogs(prev, live));
    setError('');
    handleSettled(live);
  });

  onCleanup(clearTimer);

  const cancel = async () => {
    const current = job();
    if (!current || !isActiveJob(current)) return;
    try {
      const next = await api.cancelProvisioningJob(current.id);
      setJob(next);
      props.onJobUpdate?.(next);
    } catch (err: any) {
      setError(err?.message || 'Failed to cancel job');
    }
  };

  return (
    <Show when={props.jobId}>
      <div class="panel panel-accent p-4">
        <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h2 class="text-[14px] font-bold uppercase tracking-widest text-surf-300">Job Monitor</h2>
              <Show when={job()}>
                {(j) => <StatusBadge status={j().status} />}
              </Show>
              <span class={`text-[10px] uppercase tracking-widest border px-2 py-1 ${props.liveConnected ? 'border-surf-300 text-surf-300' : 'border-base-600 text-base-400'}`}>
                {props.liveConnected ? 'Live' : 'Polling'}
              </span>
            </div>
            <Show when={job()} fallback={<div class="text-base-300 text-[12px] mt-2">Loading job...</div>}>
              {(j) => (
                <div class="text-base-300 text-[12px] mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  <span class="font-mono break-all">{j().id}</span>
                  <span>{j().action}{j().target ? ` -> ${j().target}` : ''}</span>
                  <span>{formatDateTime(j().startedAt)}</span>
                  <Show when={j().error}>
                    <span class="text-scarlet-300 font-semibold">{j().error}</span>
                  </Show>
                </div>
              )}
            </Show>
          </div>
          <div class="flex gap-2 flex-wrap">
            <Show when={job() && isActiveJob(job())}>
              <Button variant="danger" size="sm" onClick={cancel}>Cancel</Button>
            </Show>
            <Show when={props.onClear}>
              <Button variant="ghost" size="sm" onClick={props.onClear}>Clear</Button>
            </Show>
          </div>
        </div>

        <Show when={error()}>
          <div class="text-[12px] text-scarlet-300 font-semibold mt-3">{error()}</div>
        </Show>

        <Show when={job()?.logs?.length}>
          <pre class="mt-4 max-h-[280px] overflow-auto bg-base-950 border-2 border-base-600 p-3 text-[11px] leading-relaxed text-base-200 whitespace-pre-wrap break-words">{job()!.logs!.join('\n')}</pre>
        </Show>
      </div>
    </Show>
  );
}
