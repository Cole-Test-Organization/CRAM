import { createMemo, createResource, createSignal, For, Show } from 'solid-js';
import {
  api,
  type ProxmoxDiscoveredNetwork,
  type ProxmoxDiscoveredNode,
  type ProxmoxDiscoveredStorage,
  type ProxmoxDiscoveredVm,
} from '../lib/api';
import Button from '../components/Button';
import StatusBadge from '../components/StatusBadge';
import BrokerTabs from './BrokerTabs';

function gib(bytes?: number): string {
  if (bytes === undefined || bytes === null) return '—';
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

function isoStores(node: ProxmoxDiscoveredNode): ProxmoxDiscoveredStorage[] {
  return node.storages.filter((s) => s.content.includes('iso'));
}

function vmStores(node: ProxmoxDiscoveredNode): ProxmoxDiscoveredStorage[] {
  return node.storages.filter((s) => s.content.includes('images'));
}

function bridges(node: ProxmoxDiscoveredNode): ProxmoxDiscoveredNetwork[] {
  return node.networks.filter((n) => n.isBridge);
}

// A labeled list of "asset" chips inside a node card. Each row's value is the literal
// you'd paste into a Proxmox deployment module (template VMID, datastore id, bridge name).
function AssetGroup(props: { label: string; count: number; children: any }) {
  return (
    <div>
      <div class="text-[10px] uppercase tracking-widest text-surf-300 font-bold mb-1.5">
        {props.label} <span class="text-base-400">({props.count})</span>
      </div>
      <Show when={props.count} fallback={<div class="text-[12px] text-base-400 italic">none</div>}>
        <div class="flex flex-col gap-1">{props.children}</div>
      </Show>
    </div>
  );
}

function NodeCard(props: { node: ProxmoxDiscoveredNode }) {
  const node = () => props.node;
  return (
    <div class="press-card p-4 flex flex-col gap-4">
      <div class="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <div class="font-semibold text-base-50 text-sm break-words">{node().name}</div>
          <div class="text-[11px] text-base-400 uppercase tracking-wider mt-1">
            mem {gib(node().memoryBytes)} / {gib(node().maxMemoryBytes)}
            <Show when={node().cpu !== undefined}>{` · cpu ${(node().cpu! * 100).toFixed(0)}%`}</Show>
          </div>
        </div>
        <StatusBadge
          status={node().status === 'online' ? 'ready' : 'idle'}
          label={node().status || 'unknown'}
          tone={node().status === 'online' ? 'surf' : 'base'}
        />
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <AssetGroup label="Templates" count={node().templates.length}>
          <For each={node().templates}>
            {(tpl: ProxmoxDiscoveredVm) => (
              <div class="flex items-baseline gap-2 flex-wrap">
                <span class="font-mono text-[12px] text-surf-200 font-semibold">{tpl.vmid}</span>
                <span class="text-[12px] text-base-200 break-all">{tpl.name || '(unnamed)'}</span>
              </div>
            )}
          </For>
        </AssetGroup>

        <AssetGroup label="Bridges" count={bridges(node()).length}>
          <For each={bridges(node())}>
            {(net: ProxmoxDiscoveredNetwork) => (
              <div class="flex items-baseline gap-2 flex-wrap">
                <span class="font-mono text-[12px] text-surf-200 font-semibold">{net.iface}</span>
                <Show when={net.cidr || net.address}>
                  <span class="font-mono text-[11px] text-base-300 break-all">{net.cidr || net.address}</span>
                </Show>
                <Show when={net.vlanAware}>
                  <span class="text-[10px] uppercase tracking-wider text-base-400">vlan-aware</span>
                </Show>
              </div>
            )}
          </For>
        </AssetGroup>

        <AssetGroup label="VM datastores" count={vmStores(node()).length}>
          <For each={vmStores(node())}>
            {(store: ProxmoxDiscoveredStorage) => (
              <div class="flex items-baseline gap-2 flex-wrap">
                <span class="font-mono text-[12px] text-surf-200 font-semibold">{store.storage}</span>
                <span class="text-[11px] text-base-400">{gib(store.availableBytes)} free</span>
              </div>
            )}
          </For>
        </AssetGroup>

        <AssetGroup label="ISO datastores" count={isoStores(node()).length}>
          <For each={isoStores(node())}>
            {(store: ProxmoxDiscoveredStorage) => (
              <div class="flex items-baseline gap-2 flex-wrap">
                <span class="font-mono text-[12px] text-surf-200 font-semibold">{store.storage}</span>
                <span class="text-[11px] text-base-400">{gib(store.availableBytes)} free</span>
              </div>
            )}
          </For>
        </AssetGroup>
      </div>
    </div>
  );
}

export default function BrokerProxmox() {
  // Manual fetch: discovery hits the live Proxmox API (a few seconds) and needs the
  // PROXMOX_VE_* secrets, so we only run it when the operator clicks Discover. The
  // run-token source is falsy (0) on mount → no auto-fetch; each click bumps it so the
  // resource (re-)runs.
  const [runToken, setRunToken] = createSignal(0);
  const [discovery] = createResource(
    () => runToken() || false,
    () => api.discoverProxmox(),
  );

  const result = () => discovery() ?? null;
  const errorMessage = () => {
    const err = discovery.error as { message?: string } | undefined;
    return err?.message || '';
  };
  const usedVmIds = createMemo(() => result()?.usedVmIds ?? []);

  const discover = () => setRunToken((n) => n + 1);

  return (
    <div>
      <div class="flex flex-col gap-3 mb-6 md:flex-row md:justify-between md:items-center">
        <div>
          <h1 class="text-[26px] font-bold font-[family-name:var(--font-display)]">Broker</h1>
          <div class="text-base-400 text-[12px] mt-1">
            <Show when={result()} fallback="Discover the LAN Proxmox cluster to fill in a deployment">
              {(r) => `${r().nodes.length} nodes · ${r().templates.length} templates · ${usedVmIds().length} VMIDs in use`}
            </Show>
          </div>
        </div>
        <div class="flex gap-2 flex-wrap">
          <Button variant="primary" size="sm" disabled={discovery.loading} onClick={discover}>
            {discovery.loading ? 'Discovering…' : result() ? 'Re-discover' : 'Discover Proxmox'}
          </Button>
        </div>
      </div>

      <BrokerTabs active="proxmox" />

      <Show when={errorMessage()}>
        <div class="mb-4 p-3 border-2 border-scarlet-500/50 bg-scarlet-500/10 text-scarlet-300 text-[12px] font-semibold break-words">
          {errorMessage()}
          <div class="text-[11px] text-scarlet-300/80 font-normal mt-1">
            Discovery needs the <span class="font-mono">PROXMOX_VE_ENDPOINT</span> and{' '}
            <span class="font-mono">PROXMOX_VE_API_TOKEN</span> secrets — set them on the Secrets tab.
          </div>
        </div>
      </Show>

      <Show
        when={result()}
        fallback={
          <Show when={!discovery.loading && !errorMessage()}>
            <div class="panel panel-accent">
              <div class="text-base-400 text-center p-10 text-sm italic">
                Click <span class="text-surf-300 not-italic font-semibold">Discover Proxmox</span> to
                inventory your cluster's nodes, templates, datastores, and bridges.
              </div>
            </div>
          </Show>
        }
      >
        {(r) => (
          <div class="flex flex-col gap-5">
            <div class="text-[11px] text-base-400">
              <span class="uppercase tracking-wider">endpoint</span>{' '}
              <span class="font-mono text-base-200 break-all">{r().endpoint}</span>
            </div>

            <Show when={r().errors.length || r().permissionHints.length}>
              <div class="border-2 border-amber-300 bg-amber-300/5 p-3 flex flex-col gap-2">
                <div class="text-[11px] uppercase tracking-widest text-amber-300 font-bold">
                  Partial results — token permissions
                </div>
                <For each={r().permissionHints}>
                  {(hint) => <div class="text-[12px] text-base-200 break-words">{hint}</div>}
                </For>
                <For each={r().errors}>
                  {(err) => <div class="text-[11px] text-base-400 font-mono break-words">{err}</div>}
                </For>
              </div>
            </Show>

            <Show when={usedVmIds().length}>
              <div>
                <div class="text-[14px] uppercase tracking-widest font-bold text-surf-300 mb-2">
                  VMIDs in use
                </div>
                <div class="flex gap-1.5 flex-wrap">
                  <For each={usedVmIds()}>
                    {(vmid) => (
                      <span class="font-mono text-[11px] text-base-200 border border-base-600 px-2 py-0.5">{vmid}</span>
                    )}
                  </For>
                </div>
                <div class="text-[11px] text-base-400 mt-1">Pick a free VMID for a new firewall's placement.</div>
              </div>
            </Show>

            <div>
              <div class="text-[14px] uppercase tracking-widest font-bold text-surf-300 mb-3">Nodes</div>
              <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <For
                  each={r().nodes}
                  fallback={<div class="text-base-400 text-sm italic p-4">No nodes returned.</div>}
                >
                  {(node) => <NodeCard node={node} />}
                </For>
              </div>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}
