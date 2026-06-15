import { A, useParams } from '@solidjs/router';
import { createMemo, createResource, createSignal, For, Show } from 'solid-js';
import { api, type ProvisioningJob, type ProvisioningResource } from '../lib/api';
import BackLink from '../components/BackLink';
import Button from '../components/Button';
import { formatDateTime, JobMonitor, LaunchModal, resourceTitle, StatusPill } from './HomelabCommon';

export default function HomelabDetail() {
  const params = useParams<{ id: string }>();
  const [launchOpen, setLaunchOpen] = createSignal(false);
  const [monitorJobId, setMonitorJobId] = createSignal<string | null>(null);
  const [actionError, setActionError] = createSignal('');
  const [busy, setBusy] = createSignal('');

  const [deployments] = createResource(() => api.listProvisioningDeployments());
  const [deployment] = createResource(() => params.id, (id) => api.getProvisioningDeployment(id));
  const [resources, { refetch: refetchResources }] = createResource(() => api.listProvisioningResources());
  const [jobs, { refetch: refetchJobs }] = createResource(() => api.listProvisioningJobs({ limit: 50 }));

  const deploymentResources = createMemo(() => (resources() || []).filter((r) => r.deploymentId === params.id));
  const deploymentJobs = createMemo(() => (jobs() || []).filter((j) => j.deployment === params.id || deploymentResources().some((r) => r.hostname === j.target || r.id === j.target)).slice(0, 10));

  const refreshAll = () => {
    refetchResources();
    refetchJobs();
  };

  const launched = (job: ProvisioningJob) => {
    setMonitorJobId(job.id);
    refetchJobs();
  };

  const runJob = async (label: string, runner: () => Promise<ProvisioningJob>) => {
    setBusy(label);
    setActionError('');
    try {
      launched(await runner());
    } catch (err: any) {
      setActionError(err?.message || `Failed to ${label}`);
    } finally {
      setBusy('');
    }
  };

  const deprovision = async () => {
    if (!confirm(`Deprovision ${params.id}? This queues Terraform destroy work for tracked resources.`)) return;
    await runJob('deprovision', () => api.deprovisionProvisioningDeployment(params.id, {}));
  };

  const downResource = async (resource: ProvisioningResource) => {
    if (!confirm(`Destroy ${resourceTitle(resource)}?`)) return;
    await runJob(`down-${resource.id}`, () => api.downProvisioningResource(resource.id, {}));
  };

  const powerAction = async (resource: ProvisioningResource, action: 'start' | 'stop' | 'refresh') => {
    setBusy(`${action}-${resource.id}`);
    setActionError('');
    try {
      if (action === 'start') await api.startProvisioningResource(resource.id);
      else if (action === 'stop') await api.stopProvisioningResource(resource.id);
      else await api.refreshProvisioningPowerState(resource.id);
      refetchResources();
    } catch (err: any) {
      setActionError(err?.message || `Failed to ${action} ${resourceTitle(resource)}`);
    } finally {
      setBusy('');
    }
  };

  return (
    <div>
      <BackLink fallbackHref="/homelab" fallbackLabel="Homelab" />

      <Show when={deployment()} fallback={<div class="text-base-300 p-10 text-center">Loading...</div>}>
        {(d) => (
          <>
            <div class="flex flex-col gap-3 mb-6 md:flex-row md:justify-between md:items-start">
              <div class="min-w-0">
                <div class="flex items-center gap-2 flex-wrap mb-2">
                  <h1 class="text-[26px] font-bold font-[family-name:var(--font-display)] break-words">{d().id}</h1>
                  <StatusPill status={d().deployable ? 'deployable' : 'resource-only'} />
                </div>
                <div class="text-base-400 text-[12px] flex gap-3 flex-wrap uppercase tracking-wider break-words">
                  <span>{d().provider || 'unknown'}</span>
                  <Show when={d().providerProfile}><span>{d().providerProfile}</span></Show>
                  <Show when={d().projectName}><span>{d().projectName}</span></Show>
                  <span>{d().resourceCount} resources</span>
                  <span>{d().stepCount} steps</span>
                </div>
              </div>
              <div class="flex gap-2 flex-wrap">
                <Button variant="ghost" size="sm" onClick={refreshAll}>Refresh</Button>
                <Button variant="primary" size="sm" onClick={() => setLaunchOpen(true)}>Launch</Button>
                <Show when={d().deployable}>
                  <Button variant="danger" size="sm" disabled={Boolean(busy())} onClick={deprovision}>
                    {busy() === 'deprovision' ? 'Queueing...' : 'Deprovision'}
                  </Button>
                </Show>
              </div>
            </div>

            <Show when={actionError()}>
              <div class="panel p-3 mb-5 border-scarlet-400 text-scarlet-300 text-[12px] font-semibold">{actionError()}</div>
            </Show>

            <Show when={monitorJobId()}>
              <div class="mb-5">
                <JobMonitor
                  jobId={monitorJobId()}
                  onClear={() => setMonitorJobId(null)}
                  onSettled={refreshAll}
                />
              </div>
            </Show>

            <div class="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
              <section class="flex flex-col gap-5">
                <div>
                  <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <h2 class="text-[14px] uppercase tracking-widest font-bold text-surf-300">Configured Resources</h2>
                    <span class="text-[11px] text-base-400 uppercase tracking-wider">{d().resources.length}</span>
                  </div>
                  <div class="panel panel-accent">
                    <For each={d().resources}>
                      {(resource) => {
                        const runtime = () => deploymentResources().find((r) => r.hostname === resource.hostname || r.name === resource.name);
                        return (
                          <div class="press-row gap-3 flex-col items-stretch md:flex-row md:items-center border-b border-base-700 last:border-b-0">
                            <div class="w-full min-w-0 md:flex-1 md:min-w-[280px]">
                              <div class="text-sm text-base-50 font-semibold break-words">{resource.hostname}</div>
                              <div class="text-[11px] text-base-400 uppercase tracking-wider mt-1">
                                {resource.kind} · {resource.provider || d().provider || 'unknown'}
                              </div>
                              <Show when={runtime()?.providerResourceId}>
                                <div class="font-mono text-[11px] text-base-300 mt-1 break-all">{runtime()!.providerResourceId}</div>
                              </Show>
                            </div>
                            <Show when={runtime()} fallback={<StatusPill status="not-created" />}>
                              {(r) => <StatusPill status={r().lifecycleStatus} />}
                            </Show>
                            <div class="grid grid-cols-2 gap-2 w-full max-w-full min-w-0 md:flex md:w-auto md:max-w-none md:flex-wrap">
                              <Button class="w-full md:w-auto" variant="ghost" size="sm" disabled={Boolean(busy())} onClick={() => runJob(`up-${resource.hostname}`, () => api.upProvisioningResource(d().id, resource.hostname, {}))}>
                                {busy() === `up-${resource.hostname}` ? 'Queueing...' : 'Up'}
                              </Button>
                              <Show when={runtime()}>
                                {(r) => (
                                  <>
                                    <Button class="w-full md:w-auto" variant="danger" size="sm" disabled={Boolean(busy())} onClick={() => downResource(r())}>
                                      {busy() === `down-${r().id}` ? 'Queueing...' : 'Down'}
                                    </Button>
                                    <Button class="w-full md:w-auto" variant="ghost" size="sm" disabled={Boolean(busy())} onClick={() => powerAction(r(), 'refresh')}>Power</Button>
                                    <Button class="w-full md:w-auto" variant="ghost" size="sm" disabled={Boolean(busy())} onClick={() => powerAction(r(), 'start')}>Start</Button>
                                    <Button class="w-full md:w-auto" variant="ghost" size="sm" disabled={Boolean(busy())} onClick={() => powerAction(r(), 'stop')}>Stop</Button>
                                  </>
                                )}
                              </Show>
                            </div>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                </div>

                <div>
                  <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <h2 class="text-[14px] uppercase tracking-widest font-bold text-surf-300">Deployment Steps</h2>
                    <span class="text-[11px] text-base-400 uppercase tracking-wider">{d().steps.length}</span>
                  </div>
                  <div class="panel panel-accent">
                    <For each={d().steps} fallback={<div class="text-base-400 text-center p-8 text-sm italic break-words">No deployment steps; create resources individually.</div>}>
                      {(step, index) => (
                        <div class="press-row gap-3 flex-wrap border-b border-base-700 last:border-b-0">
                          <div class="w-8 h-8 border-2 border-base-500 bg-base-950 flex items-center justify-center text-[12px] font-bold text-surf-300 shrink-0">{index() + 1}</div>
                          <div class="flex-1 min-w-[70%]">
                            <div class="text-sm text-base-50 font-semibold break-words">{step.name}</div>
                            <div class="text-[11px] text-base-400 uppercase tracking-wider mt-1">{step.action}{step.resourceAction ? ` -> ${step.resourceAction}` : ''}</div>
                            <Show when={step.description}>
                              <div class="text-[12px] text-base-300 mt-1">{step.description}</div>
                            </Show>
                            <Show when={step.targets.length}>
                              <div class="flex gap-2 flex-wrap mt-2">
                                <For each={step.targets}>
                                  {(target) => <span class="font-mono text-[11px] text-base-200 border border-base-600 px-2 py-1">{target}</span>}
                                </For>
                              </div>
                            </Show>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </section>

              <aside class="flex flex-col gap-5">
                <section>
                  <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <h2 class="text-[14px] uppercase tracking-widest font-bold text-surf-300">Tracked Resources</h2>
                    <span class="text-[11px] text-base-400 uppercase tracking-wider">{deploymentResources().length}</span>
                  </div>
                  <div class="panel panel-accent">
                    <For each={deploymentResources()} fallback={<div class="text-base-400 text-center p-8 text-sm italic">No runtime records for this deployment.</div>}>
                      {(resource) => (
                        <div class="press-row gap-3 flex-wrap border-b border-base-700 last:border-b-0">
                          <div class="flex-1 min-w-[58%]">
                            <div class="text-sm text-base-50 font-semibold break-words">{resourceTitle(resource)}</div>
                            <div class="text-[11px] text-base-400 uppercase tracking-wider mt-1">{resource.id}</div>
                            <Show when={resource.powerState}>
                              <div class="text-[11px] text-base-300 mt-1">Power: {resource.powerState}</div>
                            </Show>
                          </div>
                          <div class="w-full md:w-auto">
                            <StatusPill status={resource.lifecycleStatus} />
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </section>

                <section>
                  <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <h2 class="text-[14px] uppercase tracking-widest font-bold text-surf-300">Recent Jobs</h2>
                    <Button variant="ghost" size="sm" onClick={() => refetchJobs()}>Refresh</Button>
                  </div>
                  <div class="panel panel-accent">
                    <For each={deploymentJobs()} fallback={<div class="text-base-400 text-center p-8 text-sm italic">No jobs for this deployment.</div>}>
                      {(job) => (
                        <button type="button" class="press-row w-full text-left gap-3 flex-wrap border-b border-base-700 last:border-b-0" onClick={() => setMonitorJobId(job.id)}>
                          <div class="flex-1 min-w-[58%]">
                            <div class="text-sm text-base-50 font-semibold">{job.action}{job.target ? ` -> ${job.target}` : ''}</div>
                            <div class="text-[11px] text-base-400 uppercase tracking-wider mt-1">{formatDateTime(job.createdAt)}</div>
                          </div>
                          <div class="w-full md:w-auto">
                            <StatusPill status={job.status} />
                          </div>
                        </button>
                      )}
                    </For>
                  </div>
                </section>

                <section>
                  <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <h2 class="text-[14px] uppercase tracking-widest font-bold text-surf-300">Required Secrets</h2>
                    <span class="text-[11px] text-base-400 uppercase tracking-wider">{d().requiredEnv.length}</span>
                  </div>
                  <div class="panel panel-accent p-3">
                    <div class="flex gap-2 flex-wrap">
                      <For each={d().requiredEnv} fallback={<span class="text-base-400 text-sm italic">None</span>}>
                        {(name) => <span class="font-mono text-[11px] text-base-200 border border-base-600 px-2 py-1 break-all">{name}</span>}
                      </For>
                    </div>
                  </div>
                </section>
              </aside>
            </div>

            <div class="mt-5">
              <A href="/homelab" class="text-surf-300 hover:underline text-[12px] uppercase tracking-wider">Back to Homelab</A>
            </div>

            <LaunchModal
              open={launchOpen()}
              deployments={deployments() || []}
              initialDeploymentId={d().id}
              onClose={() => setLaunchOpen(false)}
              onLaunched={launched}
            />
          </>
        )}
      </Show>
    </div>
  );
}
