import { createEffect, createMemo, createResource, createSignal, For, Show } from 'solid-js';
import { api, type ProvisioningDeploymentDescriptor, type ProvisioningDeploymentSummary, type ProvisioningJob, type ProvisioningRdpTunnel, type ProvisioningResource } from '../lib/api';
import Button from '../components/Button';
import Modal from '../components/Modal';
import FormField, { formInputClass, formSelectClass } from '../components/FormField';
import { formatDateTime } from '../utils/date';
import { isHttpUrl, isIpv4, isPrivateIpv4 } from '../utils/network';

// ── Connection endpoints ─────────────────────────────────────────────────────
// Provider-agnostic by construction: we never branch on `resource.provider`.
// Every Terraform stack (AWS today; GCP/Azure later) writes its addressing into
// the resource `outputs` blob, just under different key names — ubuntu emits
// `server.public_ip`, windows `endpoint.private_ip`, a VM-Series firewall
// `firewall.management_public`, Panorama `panorama.https_url`, EKS `eks.endpoint`,
// and so on. Rather than maintain a per-provider/per-kind lookup, we walk the blob
// and surface any value that *is* an IPv4 address or an http(s) URL. A new provider
// or resource kind needs zero changes here as long as its outputs carry the
// address — there is no `if (provider === 'aws')` ladder to keep in sync, and no
// provider-specific code leaks into the GUI.

export type ResourceEndpointFamily = 'ipv4' | 'url';
export type ResourceEndpointScope = 'public' | 'private' | 'unknown';

export interface ResourceEndpoint {
  label: string;
  address: string;
  family: ResourceEndpointFamily;
  scope: ResourceEndpointScope;
  /** Present for `url` endpoints so the UI can offer an "open" link. */
  href: string | null;
  /** Best "connect here" target (first public IP, else first URL). */
  primary: boolean;
}

type RawEndpoint = { label: string; address: string; family: ResourceEndpointFamily };

// Pull every connectable address out of a resource's Terraform outputs, ordered
// public-IP → URL → private-IP, with the best "connect here" target flagged primary.
export function resourceConnections(resource: Pick<ProvisioningResource, 'outputs'>): ResourceEndpoint[] {
  const raw: RawEndpoint[] = [];
  const stack: Array<{ key: string; node: unknown }> = [{ key: 'address', node: resource.outputs ?? null }];

  while (stack.length) {
    const { key, node } = stack.pop()!;
    if (typeof node === 'string') {
      const address = node.trim();
      const label = key.replace(/[_\s]+/g, ' ').trim() || key;
      if (isIpv4(address)) raw.push({ label, address, family: 'ipv4' });
      else if (isHttpUrl(address)) raw.push({ label, address, family: 'url' });
    } else if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i -= 1) stack.push({ key, node: node[i] });
    } else if (node && typeof node === 'object') {
      const entries = Object.entries(node as Record<string, unknown>);
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const [childKey, childValue] = entries[i];
        stack.push({ key: childKey, node: childValue });
      }
    }
  }

  const seen = new Set<string>();
  const endpoints: ResourceEndpoint[] = [];
  for (const item of raw) {
    if (seen.has(item.address)) continue;
    seen.add(item.address);
    let scope: ResourceEndpointScope = item.family === 'ipv4' ? (isPrivateIpv4(item.address) ? 'private' : 'public') : 'unknown';
    if (item.family === 'url') {
      const host = new URL(item.address).hostname;
      scope = isIpv4(host) ? (isPrivateIpv4(host) ? 'private' : 'public') : 'public';
    }
    endpoints.push({
      ...item,
      scope,
      href: item.family === 'url' ? item.address : null,
      primary: false,
    });
  }

  const priority = new Map([
    ['ipv4:public', 0],
    ['url:public', 1],
    ['url:private', 1],
    ['url:unknown', 1],
    ['ipv4:private', 2],
  ]);
  endpoints.sort((a, b) => (priority.get(`${a.family}:${a.scope}`) ?? 3) - (priority.get(`${b.family}:${b.scope}`) ?? 3));
  const primary = endpoints.find((endpoint) => (endpoint.family === 'ipv4' && endpoint.scope === 'public') || endpoint.family === 'url');
  if (primary) primary.primary = true;
  return endpoints;
}

// Renders the connectable addresses for a runtime resource. Returns nothing when
// the resource has no addresses yet (not deployed, or outputs not captured).
export function ResourceConnections(props: { resource: ProvisioningResource | null | undefined; class?: string }) {
  const endpoints = createMemo(() => (props.resource ? resourceConnections(props.resource) : []));
  return (
    <Show when={endpoints().length}>
      <div class={`flex flex-col gap-1 ${props.class ?? ''}`}>
        <For each={endpoints()}>
          {(endpoint) => (
            <CopyableValueRow
              label={endpoint.label}
              value={endpoint.address}
              href={endpoint.href}
              strong={endpoint.primary}
            />
          )}
        </For>
      </div>
    </Show>
  );
}

export function RdpTunnelEndpoint(props: { tunnel: ProvisioningRdpTunnel | null | undefined; class?: string }) {
  return (
    <Show when={props.tunnel && props.tunnel.status !== 'closed' ? props.tunnel : null}>
      {(tunnel) => (
        <div class={`flex flex-col gap-1 ${props.class ?? ''}`}>
          <CopyableValueRow label="Broker RDP" value={tunnel().rdpEndpoint} strong />
          <Show when={tunnel().username}>
            <CopyableValueRow label="Username" value={tunnel().username!} />
          </Show>
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-[10px] uppercase tracking-wider text-base-400 w-[88px] shrink-0">Tunnel</span>
            <span class="font-mono text-[12px] text-base-200 break-all">{tunnel().status}</span>
            <Show when={tunnel().expiresAt}>
              <span class="text-[10px] uppercase tracking-wider text-base-400">until {formatDateTime(tunnel().expiresAt!)}</span>
            </Show>
          </div>
        </div>
      )}
    </Show>
  );
}

function CopyableValueRow(props: { label: string; value: string; href?: string | null; strong?: boolean }) {
  const [copied, setCopied] = createSignal(false);
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(props.value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard unavailable (insecure context or denied) — non-fatal.
    }
  };
  const addressClass = () => `font-mono text-[12px] break-all ${props.strong ? 'text-surf-200 font-semibold' : 'text-base-200'}`;
  return (
    <div class="flex items-center gap-2 flex-wrap">
      <span class="text-[10px] uppercase tracking-wider text-base-400 w-[88px] shrink-0">{props.label}</span>
      <Show
        when={props.href}
        fallback={
          <button type="button" onClick={copy} title="Click to copy" class={`text-left hover:text-surf-300 ${addressClass()}`}>
            {props.value}
          </button>
        }
      >
        <a href={props.href!} target="_blank" rel="noreferrer" class={`underline decoration-dotted text-surf-300 hover:text-surf-200 ${addressClass()}`}>
          {props.value}
        </a>
        <button
          type="button"
          onClick={copy}
          title="Copy"
          class="text-[10px] uppercase tracking-wider border border-base-600 px-1.5 py-0.5 text-base-400 hover:text-surf-300 hover:border-surf-400"
        >
          copy
        </button>
      </Show>
      <Show when={copied()}>
        <span class="text-[10px] uppercase tracking-wider text-surf-300">copied</span>
      </Show>
    </div>
  );
}

export function LaunchModal(props: {
  open: boolean;
  deployments: ProvisioningDeploymentSummary[];
  initialDeploymentId?: string | null;
  onClose: () => void;
  onLaunched: (job: ProvisioningJob) => void;
}) {
  const [deploymentId, setDeploymentId] = createSignal('');
  const [instanceName, setInstanceName] = createSignal('');
  const [paramValues, setParamValues] = createSignal<Record<string, string | number | boolean>>({});
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal('');

  // Only templates are launchable into new instances; deployed instances are managed
  // from their own detail page.
  const templates = () => props.deployments.filter((deployment) => deployment.isTemplate);

  const [deploymentDetail] = createResource(
    () => (props.open && deploymentId() ? deploymentId() : null),
    (id) => id ? api.getProvisioningDeployment(id) : Promise.resolve(null),
  );
  const [secrets] = createResource(
    () => props.open,
    (open) => open ? api.listProvisioningSecrets() : Promise.resolve([]),
  );

  createEffect(() => {
    if (!props.open) return;
    const list = templates();
    const wanted = props.initialDeploymentId && list.some((deployment) => deployment.id === props.initialDeploymentId)
      ? props.initialDeploymentId
      : list[0]?.id || '';
    setDeploymentId(wanted);
    setInstanceName('');
    setParamValues({});
    setError('');
  });

  createEffect(() => {
    const deployment = deploymentDetail();
    if (!deployment) return;

    const next: Record<string, string | number | boolean> = {};
    for (const input of deployment.inputs) {
      if (input.default !== undefined) next[input.name] = input.default;
      else if (input.type === 'boolean') next[input.name] = false;
      else next[input.name] = '';
    }
    setParamValues((current) => ({ ...next, ...current }));
  });

  const selectedDeployment = () => deploymentDetail() as ProvisioningDeploymentDescriptor | null;
  const storedSecrets = () => new Set((secrets() || []).map((secret) => secret.name));
  const missingSecrets = () => selectedDeployment()?.requiredEnv.filter((name) => !storedSecrets().has(name)) || [];

  const params = () => {
    const deployment = selectedDeployment();
    if (!deployment) return {};
    const values = paramValues();
    const out: Record<string, unknown> = {};
    for (const input of deployment.inputs) {
      const value = values[input.name];
      if (input.type === 'number') out[input.name] = Number(value);
      else out[input.name] = value;
    }
    return out;
  };

  const launch = async () => {
    const deployment = selectedDeployment();
    const name = instanceName().trim();
    if (!deployment || !name) return;
    setSubmitting(true);
    setError('');
    try {
      const job = await api.createProvisioningInstance(deployment.id, name, params());
      props.onLaunched(job);
      props.onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to deploy');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title="Deploy new instance"
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" size="md" disabled={submitting() || !selectedDeployment() || !instanceName().trim()} onClick={launch}>
            {submitting() ? 'Deploying...' : 'Deploy'}
          </Button>
        </>
      }
    >
      <div>
        <FormField label="Template">
          <select class={formSelectClass} value={deploymentId()} onChange={(e) => { setDeploymentId(e.currentTarget.value); setParamValues({}); }}>
            <For each={templates()}>
              {(deployment) => <option value={deployment.id}>{deployment.id}</option>}
            </For>
          </select>
        </FormField>

        <FormField label="Instance name">
          <input
            class={formInputClass}
            type="text"
            placeholder="e.g. win-alice"
            value={instanceName()}
            onInput={(e) => setInstanceName(e.currentTarget.value)}
          />
          <div class="text-[11px] text-base-400 mt-1">A unique copy is created under this name — deploy the same template again for another.</div>
        </FormField>

        <Show when={selectedDeployment()}>
          {(deployment) => (
            <>
              <div class="grid grid-cols-1 gap-3 md:grid-cols-3 mb-4">
                <div class="border-2 border-base-600 bg-base-950 p-3">
                  <div class="text-[10px] uppercase tracking-widest text-surf-300 font-bold">Provider</div>
                  <div class="text-base-50 text-sm mt-1">{deployment().provider || 'unknown'}</div>
                </div>
                <div class="border-2 border-base-600 bg-base-950 p-3">
                  <div class="text-[10px] uppercase tracking-widest text-surf-300 font-bold">Resources</div>
                  <div class="text-base-50 text-sm mt-1">{deployment().resourceCount}</div>
                </div>
                <div class="border-2 border-base-600 bg-base-950 p-3">
                  <div class="text-[10px] uppercase tracking-widest text-surf-300 font-bold">Secrets</div>
                  <div class={`text-sm mt-1 ${missingSecrets().length ? 'text-amber-300' : 'text-surf-300'}`}>
                    {deployment().requiredEnv.length - missingSecrets().length}/{deployment().requiredEnv.length} stored
                  </div>
                </div>
              </div>

              <Show when={deployment().inputs.length}>
                <div class="border-t-2 border-base-700 pt-3 mt-3">
                  <div class="text-[11px] uppercase tracking-widest text-surf-300 font-bold mb-2">Inputs</div>
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <For each={deployment().inputs}>
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
