import { A } from '@solidjs/router';
import { createMemo, createResource, createSignal, For, Show } from 'solid-js';
import { api, type ProvisioningDeploymentSummary, type ProvisioningJob, type ProvisioningResource } from '../lib/api';
import Button from '../components/Button';
import { JobMonitor, LaunchModal, resourceTitle, StatusPill, formatDateTime } from './HomelabCommon';

function resourceCounts(resources: ProvisioningResource[]) {
  const counts = new Map<string, number>();
  for (const resource of resources) {
    counts.set(resource.deploymentId, (counts.get(resource.deploymentId) || 0) + 1);
  }
  return counts;
}

export default function HomelabList() {
  const [launchOpen, setLaunchOpen] = createSignal(false);
  const [launchDeployment, setLaunchDeployment] = createSignal<string | null>(null);
  const [monitorJobId, setMonitorJobId] = createSignal<string | null>(null);

  const [deployments, { refetch: refetchDeployments }] = createResource(() => api.listProvisioningDeployments());
  const [resources, { refetch: refetchResources }] = createResource(() => api.listProvisioningResources());
  const [jobs, { refetch: refetchJobs }] = createResource(() => api.listProvisioningJobs({ limit: 8 }));

  const trackedCounts = createMemo(() => resourceCounts(resources() || []));

  const refreshAll = () => {
    refetchDeployments();
    refetchResources();
    refetchJobs();
  };

  const openLaunch = (deployment?: ProvisioningDeploymentSummary) => {
    setLaunchDeployment(deployment?.id || null);
    setLaunchOpen(true);
  };

  const launched = (job: ProvisioningJob) => {
    setMonitorJobId(job.id);
    refetchJobs();
  };

  return (
    <div>
      <div class="flex flex-col gap-3 mb-6 md:flex-row md:justify-between md:items-center">
        <div>
          <h1 class="text-[26px] font-bold font-[family-name:var(--font-display)]">Homelab</h1>
          <div class="text-base-400 text-[12px] mt-1">
            {deployments()?.length || 0} deployments · {resources()?.length || 0} tracked resources
          </div>
        </div>
        <div class="flex gap-2 flex-wrap">
          <Button variant="ghost" size="sm" onClick={refreshAll}>Refresh</Button>
          <Button variant="primary" size="sm" onClick={() => openLaunch()}>+ Launch</Button>
        </div>
      </div>

      <Show when={monitorJobId()}>
        <div class="mb-5">
          <JobMonitor
            jobId={monitorJobId()}
            onClear={() => setMonitorJobId(null)}
            onSettled={refreshAll}
          />
        </div>
      </Show>

      <div class="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <section>
          <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 class="text-[14px] uppercase tracking-widest font-bold text-surf-300">Deployment Catalog</h2>
            <span class="text-[11px] text-base-400 uppercase tracking-wider">{deployments()?.length || 0} seeded</span>
          </div>

          <div class="panel panel-accent">
            <Show when={!deployments.loading} fallback={<div class="text-base-300 p-10 text-center">Loading...</div>}>
              <For each={deployments() || []} fallback={
                <div class="text-base-400 text-center p-8 text-sm italic">No deployments seeded.</div>
              }>
                {(deployment) => (
                  <div class="press-row gap-3 flex-wrap border-b border-base-700 last:border-b-0">
                    <A href={`/homelab/${deployment.id}`} class="flex-1 min-w-[65%] md:min-w-[260px] no-underline">
                      <div class="font-semibold text-sm text-base-50 break-words">{deployment.id}</div>
                      <div class="flex gap-2 flex-wrap text-[11px] text-base-400 uppercase tracking-wider mt-1">
                        <span>{deployment.provider || 'unknown'}</span>
                        <span>{deployment.resourceCount} resources</span>
                        <span>{deployment.stepCount} steps</span>
                        <Show when={trackedCounts().get(deployment.id)}>
                          <span class="text-surf-300">{trackedCounts().get(deployment.id)} tracked</span>
                        </Show>
                      </div>
                    </A>
                    <div class="flex gap-2 flex-wrap">
                      <StatusPill status={deployment.deployable ? 'deployable' : 'resource-only'} />
                      <Button variant="ghost" size="sm" href={`/homelab/${deployment.id}`}>Open</Button>
                      <Button variant="primary" size="sm" onClick={() => openLaunch(deployment)}>Launch</Button>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </section>

        <aside class="flex flex-col gap-5">
          <section>
            <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 class="text-[14px] uppercase tracking-widest font-bold text-surf-300">Resources</h2>
              <span class="text-[11px] text-base-400 uppercase tracking-wider">{resources()?.length || 0} active records</span>
            </div>
            <div class="panel panel-accent">
              <Show when={!resources.loading} fallback={<div class="text-base-300 p-8 text-center">Loading...</div>}>
                <For each={resources() || []} fallback={
                  <div class="text-base-400 text-center p-8 text-sm italic">No provisioned resources yet.</div>
                }>
                  {(resource) => (
                    <A href={`/homelab/${resource.deploymentId}`} class="press-row gap-3 flex-wrap border-b border-base-700 last:border-b-0">
                      <div class="flex-1 min-w-[58%]">
                        <div class="text-sm text-base-50 font-semibold break-words">{resourceTitle(resource)}</div>
                        <div class="text-[11px] text-base-400 uppercase tracking-wider mt-1">{resource.kind || 'resource'} · {resource.deploymentId}</div>
                      </div>
                      <StatusPill status={resource.lifecycleStatus} />
                    </A>
                  )}
                </For>
              </Show>
            </div>
          </section>

          <section>
            <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 class="text-[14px] uppercase tracking-widest font-bold text-surf-300">Recent Jobs</h2>
              <Button variant="ghost" size="sm" onClick={() => refetchJobs()}>Refresh</Button>
            </div>
            <div class="panel panel-accent">
              <Show when={!jobs.loading} fallback={<div class="text-base-300 p-8 text-center">Loading...</div>}>
                <For each={jobs() || []} fallback={
                  <div class="text-base-400 text-center p-8 text-sm italic">No jobs yet.</div>
                }>
                  {(job) => (
                    <button type="button" class="press-row w-full text-left gap-3 flex-wrap border-b border-base-700 last:border-b-0" onClick={() => setMonitorJobId(job.id)}>
                      <div class="flex-1 min-w-[58%]">
                        <div class="text-sm text-base-50 font-semibold">{job.action}{job.target ? ` -> ${job.target}` : ''}</div>
                        <div class="text-[11px] text-base-400 uppercase tracking-wider mt-1">{job.deployment || 'resource'} · {formatDateTime(job.createdAt)}</div>
                      </div>
                      <StatusPill status={job.status} />
                    </button>
                  )}
                </For>
              </Show>
            </div>
          </section>
        </aside>
      </div>

      <LaunchModal
        open={launchOpen()}
        deployments={deployments() || []}
        initialDeploymentId={launchDeployment()}
        onClose={() => setLaunchOpen(false)}
        onLaunched={launched}
      />
    </div>
  );
}
