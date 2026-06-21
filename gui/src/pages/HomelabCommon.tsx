import { createEffect, createResource, createSignal, For, onCleanup, Show, untrack } from 'solid-js';
import { api, type ProvisioningDeploymentDescriptor, type ProvisioningDeploymentSummary, type ProvisioningJob, type ProvisioningJobStatus, type ProvisioningResource } from '../lib/api';
import Button from '../components/Button';
import Modal from '../components/Modal';
import FormField, { formInputClass, formSelectClass } from '../components/FormField';
import StatusBadge from '../components/StatusBadge';

export function statusTone(status: string | null | undefined): 'surf' | 'papaya' | 'scarlet' | 'amber' | 'base' | 'cerulean' {
  const s = (status || '').toLowerCase();
  if (['succeeded', 'ready', 'running'].includes(s)) return 'surf';
  if (['queued', 'terraform_applying', 'terraform_destroying', 'destroy_requested', 'pending', 'stopping'].includes(s)) return 'amber';
  if (['failed', 'canceled', 'destroyed', 'terminated'].includes(s)) return 'scarlet';
  if (['stopped', 'idle'].includes(s)) return 'base';
  return 'cerulean';
}

export function StatusPill(props: { status: string | null | undefined }) {
  const label = () => (props.status || 'unknown').replace(/[-_]/g, ' ');
  return <StatusBadge status={props.status || null} label={label()} tone={statusTone(props.status)} />;
}

export function StreamStatusPill(props: { error?: string; status: string }) {
  const live = () => props.status === 'live';
  const label = () => props.status.replace(/[-_]/g, ' ');
  return (
    <span
      title={props.error || undefined}
      class={`text-[10px] uppercase tracking-widest border px-2 py-1 font-semibold ${
        live() ? 'border-surf-300 text-surf-300' : 'border-base-600 text-base-400'
      }`}
    >
      {label()}
    </span>
  );
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'not started';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function resourceTitle(resource: ProvisioningResource): string {
  return resource.name || resource.hostname || resource.id;
}

export function isActiveJob(job: ProvisioningJob | null | undefined): boolean {
  return job?.status === 'queued' || job?.status === 'running';
}

export function JobMonitor(props: {
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
      setJob(next);
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
    } else {
      fetchJob(id);
    }
  });

  createEffect(() => {
    const id = props.jobId;
    const live = props.liveJob;
    if (!id || !live || live.id !== id) return;
    clearTimer();
    setJob(live);
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
                {(j) => <StatusPill status={j().status} />}
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

export type LaunchMode = 'deploy' | 'up';

export function LaunchModal(props: {
  open: boolean;
  deployments: ProvisioningDeploymentSummary[];
  initialDeploymentId?: string | null;
  initialMode?: LaunchMode | null;
  initialTarget?: string | null;
  onClose: () => void;
  onLaunched: (job: ProvisioningJob) => void;
}) {
  const [deploymentId, setDeploymentId] = createSignal('');
  const [mode, setMode] = createSignal<LaunchMode>('deploy');
  const [target, setTarget] = createSignal('');
  const [paramValues, setParamValues] = createSignal<Record<string, string | number | boolean>>({});
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal('');

  const [detail] = createResource(
    () => (props.open && deploymentId() ? deploymentId() : null),
    (id) => id ? api.getProvisioningDeployment(id) : Promise.resolve(null),
  );
  const [secrets] = createResource(
    () => props.open,
    (open) => open ? api.listProvisioningSecrets() : Promise.resolve([]),
  );

  createEffect(() => {
    if (!props.open) return;
    const preferred = props.initialDeploymentId || props.deployments[0]?.id || '';
    setDeploymentId(preferred);
    setMode(props.initialMode ?? 'deploy');
    setTarget(props.initialTarget ?? '');
    setParamValues({});
    setError('');
  });

  createEffect(() => {
    const d = detail();
    if (!d) return;
    if (!d.deployable) setMode('up');
    if (
      (!target() || !d.resources.some((resource) => resource.hostname === target())) &&
      d.resources.length
    ) {
      setTarget(d.resources[0].hostname);
    }

    const next: Record<string, string | number | boolean> = {};
    for (const input of d.inputs) {
      if (input.default !== undefined) next[input.name] = input.default;
      else if (input.type === 'boolean') next[input.name] = false;
      else next[input.name] = '';
    }
    setParamValues((current) => ({ ...next, ...current }));
  });

  const selected = () => detail() as ProvisioningDeploymentDescriptor | null;
  const storedSecrets = () => new Set((secrets() || []).map((s) => s.name));
  const missingSecrets = () => selected()?.requiredEnv.filter((name) => !storedSecrets().has(name)) || [];

  const params = () => {
    const d = selected();
    if (!d) return {};
    const values = paramValues();
    const out: Record<string, unknown> = {};
    for (const input of d.inputs) {
      const value = values[input.name];
      if (input.type === 'number') out[input.name] = Number(value);
      else out[input.name] = value;
    }
    return out;
  };

  const launch = async () => {
    const d = selected();
    if (!d) return;
    setSubmitting(true);
    setError('');
    try {
      const job = mode() === 'deploy'
        ? await api.deployProvisioningDeployment(d.id, params())
        : await api.upProvisioningResource(d.id, target(), params());
      props.onLaunched(job);
      props.onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to launch job');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title="Launch Broker Job"
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" size="md" disabled={submitting() || !selected() || (mode() === 'up' && !target())} onClick={launch}>
            {submitting() ? 'Launching...' : 'Launch'}
          </Button>
        </>
      }
    >
      <div>
        <FormField label="Deployment">
          <select class={formSelectClass} value={deploymentId()} onChange={(e) => { setDeploymentId(e.currentTarget.value); setTarget(''); setParamValues({}); }}>
            <For each={props.deployments}>
              {(d) => <option value={d.id}>{d.id}</option>}
            </For>
          </select>
        </FormField>

        <Show when={selected()}>
          {(d) => (
            <>
              <div class="grid grid-cols-1 gap-3 md:grid-cols-3 mb-4">
                <div class="border-2 border-base-600 bg-base-950 p-3">
                  <div class="text-[10px] uppercase tracking-widest text-surf-300 font-bold">Provider</div>
                  <div class="text-base-50 text-sm mt-1">{d().provider || 'unknown'}</div>
                </div>
                <div class="border-2 border-base-600 bg-base-950 p-3">
                  <div class="text-[10px] uppercase tracking-widest text-surf-300 font-bold">Resources</div>
                  <div class="text-base-50 text-sm mt-1">{d().resourceCount}</div>
                </div>
                <div class="border-2 border-base-600 bg-base-950 p-3">
                  <div class="text-[10px] uppercase tracking-widest text-surf-300 font-bold">Secrets</div>
                  <div class={`text-sm mt-1 ${missingSecrets().length ? 'text-amber-300' : 'text-surf-300'}`}>
                    {d().requiredEnv.length - missingSecrets().length}/{d().requiredEnv.length} stored
                  </div>
                </div>
              </div>

              <div class="flex gap-2 flex-wrap mb-4">
                <Show when={d().deployable}>
                  <button type="button" class={`press press-sm ${mode() === 'deploy' ? 'press-primary' : 'press-ghost'}`} onClick={() => setMode('deploy')}>Deploy steps</button>
                </Show>
                <button type="button" class={`press press-sm ${mode() === 'up' ? 'press-primary' : 'press-ghost'}`} onClick={() => setMode('up')}>Create resource</button>
              </div>

              <Show when={mode() === 'up'}>
                <FormField label="Resource">
                  <select class={formSelectClass} value={target()} onChange={(e) => setTarget(e.currentTarget.value)}>
                    <For each={d().resources}>
                      {(resource) => <option value={resource.hostname}>{resource.hostname} ({resource.kind})</option>}
                    </For>
                  </select>
                </FormField>
              </Show>

              <Show when={d().inputs.length}>
                <div class="border-t-2 border-base-700 pt-3 mt-3">
                  <div class="text-[11px] uppercase tracking-widest text-surf-300 font-bold mb-2">Inputs</div>
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <For each={d().inputs}>
                      {(input) => {
                        const label = input.label || input.name;
                        const description = input.description;
                        return (
                          <Show
                            when={input.type === 'boolean'}
                            fallback={
                              <FormField label={label}>
                                <Show
                                  when={input.options?.length}
                                  fallback={
                                    <input
                                      class={formInputClass}
                                      type={input.type === 'number' ? 'number' : 'text'}
                                      value={String(paramValues()[input.name] ?? '')}
                                      onInput={(e) => setParamValues((v) => ({ ...v, [input.name]: input.type === 'number' ? Number(e.currentTarget.value) : e.currentTarget.value }))}
                                    />
                                  }
                                >
                                  <select
                                    class={formSelectClass}
                                    value={String(paramValues()[input.name] ?? '')}
                                    onChange={(e) => setParamValues((v) => ({ ...v, [input.name]: e.currentTarget.value }))}
                                  >
                                    <For each={input.options}>
                                      {(option) => <option value={String(option.value)}>{option.label}</option>}
                                    </For>
                                  </select>
                                </Show>
                                <Show when={description}>
                                  <div class="text-[11px] text-base-400 mt-1">{description}</div>
                                </Show>
                              </FormField>
                            }
                          >
                            <label class="flex items-center gap-2 border-2 border-base-600 bg-base-950 p-3 cursor-pointer">
                              <input
                                type="checkbox"
                                class="press-checkbox"
                                checked={Boolean(paramValues()[input.name])}
                                onChange={(e) => setParamValues((v) => ({ ...v, [input.name]: e.currentTarget.checked }))}
                              />
                              <span class="text-[12px] text-base-100 font-semibold">{label}</span>
                            </label>
                          </Show>
                        );
                      }}
                    </For>
                  </div>
                </div>
              </Show>

              <Show when={missingSecrets().length}>
                <div class="mt-4 border-2 border-amber-300 bg-amber-300/5 p-3">
                  <div class="text-[11px] uppercase tracking-widest text-amber-300 font-bold mb-2">Missing Secrets</div>
                  <div class="flex gap-2 flex-wrap">
                    <For each={missingSecrets()}>
                      {(name) => <span class="font-mono text-[11px] text-base-200 border border-base-600 px-2 py-1">{name}</span>}
                    </For>
                  </div>
                </div>
              </Show>
            </>
          )}
        </Show>

        <Show when={error()}>
          <div class="text-[12px] text-scarlet-300 font-semibold mt-3">{error()}</div>
        </Show>
      </div>
    </Modal>
  );
}
