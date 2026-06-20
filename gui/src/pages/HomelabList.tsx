import { A } from '@solidjs/router';
import { createMemo, createResource, createSignal, For, Show } from 'solid-js';
import { api, type ProvisioningDeploymentSummary, type ProvisioningJob, type ProvisioningResource } from '../lib/api';
import { createProvisioningEventStream } from '../lib/provisioningEvents';
import Button from '../components/Button';
import { JobMonitor, LaunchModal, resourceTitle, StatusPill, StreamStatusPill, formatDateTime } from './HomelabCommon';
import BrokerTabs from './BrokerTabs';

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
  const stream = createProvisioningEventStream({ jobsLimit: 8 });

  const trackedCounts = createMemo(() => resourceCounts(stream.resources()));
  const recentJobs = createMemo(() => stream.jobs().slice(0, 8));

  const refreshAll = () => {
    refetchDeployments();
    void stream.refresh();
  };

  const openLaunch = (deployment?: ProvisioningDeploymentSummary) => {
    setLaunchDeployment(deployment?.id || null);
    setLaunchOpen(true);
  };

  const launched = (job: ProvisioningJob) => {
    stream.upsertJob(job);
    stream.setActiveJobId(job.id);
    setMonitorJobId(job.id);
  };

  return (
    <div>
      <div class="flex flex-col gap-3 mb-6 md:flex-row md:justify-between md:items-center">
        <div>
          <h1 class="text-[26px] font-bold font-[family-name:var(--font-display)]">Broker</h1>
          <div class="text-base-400 text-[12px] mt-1">
            {deployments()?.length || 0} deployments · {stream.resources().length} tracked resources
          </div>
        </div>
        <div class="flex gap-2 flex-wrap">
          <StreamStatusPill status={stream.connectionStatus()} error={stream.error()} />
          <Button variant="ghost" size="sm" onClick={refreshAll}>Refresh</Button>
          <Button variant="primary" size="sm" onClick={() => openLaunch()}>+ Launch</Button>
        </div>
      </div>

      <BrokerTabs active="deployments" />

      <Show when={monitorJobId()}>
        <div class="mb-5">
          <JobMonitor
            jobId={monitorJobId()}
            liveConnected={stream.connectionStatus() === 'live'}
            liveJob={stream.jobById(monitorJobId())}
            onJobUpdate={stream.upsertJob}
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
                    <A href={`/broker/${deployment.id}`} class="flex-1 min-w-[65%] md:min-w-[260px] no-underline">
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
                      <Button variant="ghost" size="sm" href={`/broker/${deployment.id}`}>Open</Button>
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
              <span class="text-[11px] text-base-400 uppercase tracking-wider">{stream.resources().length} active records</span>
            </div>
            <div class="panel panel-accent">
              <For each={stream.resources()} fallback={
                <div class="text-base-400 text-center p-8 text-sm italic">No provisioned resources yet.</div>
              }>
                {(resource) => (
                  <A href={`/broker/${resource.deploymentId}`} class="press-row gap-3 flex-wrap border-b border-base-700 last:border-b-0">
                    <div class="flex-1 min-w-[58%]">
                      <div class="text-sm text-base-50 font-semibold break-words">{resourceTitle(resource)}</div>
                      <div class="text-[11px] text-base-400 uppercase tracking-wider mt-1">{resource.kind || 'resource'} · {resource.deploymentId}</div>
                    </div>
                    <StatusPill status={resource.lifecycleStatus} />
                  </A>
                )}
              </For>
            </div>
          </section>

          <section>
            <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 class="text-[14px] uppercase tracking-widest font-bold text-surf-300">Recent Jobs</h2>
              <Button variant="ghost" size="sm" onClick={() => void stream.refresh()}>Refresh</Button>
            </div>
            <div class="panel panel-accent">
              <For each={recentJobs()} fallback={
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
