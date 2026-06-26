import { createEffect, createMemo, createResource, createSignal, For, Show } from 'solid-js';
import Button from '../components/Button';
import FormField, { formInputClass } from '../components/FormField';
import Modal from '../components/Modal';
import StatusBadge from '../components/StatusBadge';
import { api, type ProvisioningDeploymentDescriptor, type ProvisioningSecretSummary } from '../lib/api';
import { formatDateTime } from '../utils/date';
import BrokerTabs from './BrokerTabs';

type SecretRow = {
  name: string;
  stored: boolean;
  required: boolean;
  readable: boolean;
  value: string | null;
  description: string | null;
  updatedAt: string | null;
  deployments: string[];
};

const RUNTIME_ENV_NAMES = new Set([
  'AWS_PROFILE',
  'AWS_GP_LAB_ALLOWED_SOURCE_CIDRS',
]);

function isManageableSecretName(name: string): boolean {
  return !RUNTIME_ENV_NAMES.has(name);
}

async function loadDeploymentDetails(ids: string[]): Promise<ProvisioningDeploymentDescriptor[]> {
  const results = await Promise.all(
    ids.map(async (id) => {
      try {
        return await api.getProvisioningDeployment(id);
      } catch {
        return null;
      }
    }),
  );
  return results.filter((d): d is ProvisioningDeploymentDescriptor => Boolean(d));
}

export default function BrokerSecrets() {
  const [query, setQuery] = createSignal('');
  const [editingName, setEditingName] = createSignal<string | null>(null);
  const [value, setValue] = createSignal('');
  const [confirmValue, setConfirmValue] = createSignal('');
  const [description, setDescription] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');
  const [notice, setNotice] = createSignal('');

  const [secrets, { refetch: refetchSecrets }] = createResource(() => api.listProvisioningSecrets());
  const [deployments] = createResource(() => api.listProvisioningDeployments());
  const [deploymentDetails] = createResource(
    () => (deployments() || []).map((d) => d.id),
    loadDeploymentDetails,
  );

  const storedByName = createMemo(() => {
    const map = new Map<string, ProvisioningSecretSummary>();
    for (const secret of secrets() || []) map.set(secret.name, secret);
    return map;
  });

  const rows = createMemo<SecretRow[]>(() => {
    const map = new Map<string, SecretRow>();
    for (const detail of deploymentDetails() || []) {
      for (const name of detail.requiredEnv) {
        if (!isManageableSecretName(name)) continue;
        const row = map.get(name) || {
          name,
          stored: false,
          required: true,
          readable: false,
          value: null,
          description: null,
          updatedAt: null,
          deployments: [],
        };
        row.required = true;
        if (!row.deployments.includes(detail.id)) row.deployments.push(detail.id);
        map.set(name, row);
      }
    }

    for (const secret of secrets() || []) {
      const row = map.get(secret.name) || {
        name: secret.name,
        stored: false,
        required: false,
        readable: false,
        value: null,
        description: null,
        updatedAt: null,
        deployments: [],
      };
      row.stored = true;
      row.readable = secret.readable;
      row.value = secret.value ?? null;
      row.description = secret.description;
      row.updatedAt = secret.updatedAt;
      map.set(secret.name, row);
    }

    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  });

  const filteredRows = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (!q) return rows();
    return rows().filter((row) =>
      row.name.toLowerCase().includes(q) ||
      row.deployments.some((deployment) => deployment.toLowerCase().includes(q)),
    );
  });

  const editingRow = createMemo(() => rows().find((row) => row.name === editingName()) || null);
  const storedCount = createMemo(() => rows().filter((row) => row.stored).length);
  const missingCount = createMemo(() => rows().filter((row) => row.required && !row.stored).length);

  createEffect(() => {
    const row = editingRow();
    setValue('');
    setConfirmValue('');
    setError('');
    setDescription(row?.description || '');
  });

  const openEditor = (name: string) => {
    setNotice('');
    setEditingName(name);
  };

  const closeEditor = () => {
    if (saving()) return;
    setEditingName(null);
  };

  const save = async () => {
    const row = editingRow();
    if (!row) return;
    const next = value();
    if (!next) {
      setError('Value is required');
      return;
    }
    if (next !== confirmValue()) {
      setError('Values do not match');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const desc = description().trim();
      await api.setProvisioningSecret(row.name, {
        value: next,
        description: desc || undefined,
      });
      await refetchSecrets();
      setNotice(`${row.name} updated`);
      setEditingName(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to update secret');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div class="flex flex-col gap-3 mb-6 md:flex-row md:justify-between md:items-center">
        <div>
          <h1 class="text-[26px] font-bold font-[family-name:var(--font-display)]">Broker</h1>
          <div class="text-base-400 text-[12px] mt-1">
            {storedCount()} stored secrets · {missingCount()} missing required
          </div>
        </div>
        <div class="flex gap-2 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => refetchSecrets()}>Refresh</Button>
        </div>
      </div>

      <BrokerTabs active="secrets" />

      <Show when={notice()}>
        <div class="mb-4 p-3 border-2 border-surf-500/50 bg-surf-500/10 text-surf-300 text-[12px] font-semibold">
          {notice()}
        </div>
      </Show>

      <Show when={secrets.error || deployments.error || deploymentDetails.error}>
        <div class="mb-4 p-3 border-2 border-scarlet-500/50 bg-scarlet-500/10 text-scarlet-300 text-[12px] font-semibold">
          Failed to load broker secrets.
        </div>
      </Show>

      <div class="flex flex-col gap-3 mb-5 md:flex-row md:items-center">
        <div class="flex items-center bg-base-950 border-2 border-base-500 px-3 py-2 gap-2 flex-1 focus-within:border-surf-300 transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-surf-400">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            class="flex-1 bg-transparent border-none outline-none text-base-50 text-sm placeholder:text-base-400"
            placeholder="Filter secrets..."
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
        </div>
      </div>

      <div class="panel panel-accent">
        <Show when={!secrets.loading && !deployments.loading && !deploymentDetails.loading} fallback={<div class="text-base-300 p-10 text-center">Loading...</div>}>
          <For each={filteredRows()} fallback={<div class="text-base-400 text-center p-8 text-sm italic">No broker secrets found.</div>}>
            {(row) => (
              <div class="press-row gap-3 flex-col items-stretch md:flex-row md:items-center border-b border-base-700 last:border-b-0">
                <div class="w-full min-w-0 md:flex-1 md:min-w-[280px]">
                  <div class="font-mono text-[13px] text-base-50 font-semibold break-all">{row.name}</div>
                  <div class="flex gap-2 flex-wrap text-[11px] text-base-400 uppercase tracking-wider mt-1">
                    <Show when={row.deployments.length} fallback={<span>Stored only</span>}>
                      <For each={row.deployments}>
                        {(deployment) => <span>{deployment}</span>}
                      </For>
                    </Show>
                  </div>
                  <Show when={row.updatedAt}>
                    <div class="text-[11px] text-base-300 mt-1">Updated {formatDateTime(row.updatedAt)}</div>
                  </Show>
                  <Show when={row.stored && row.readable && row.value}>
                    <div class="mt-2 border-2 border-base-600 bg-base-950 px-2 py-1 font-mono text-[12px] text-surf-200 break-all">
                      {row.value}
                    </div>
                  </Show>
                  <Show when={row.description}>
                    <div class="text-[11px] text-base-400 mt-1 break-words">{row.description}</div>
                  </Show>
                </div>
                <div class="flex gap-2 flex-wrap items-center">
                  <Show
                    when={row.stored}
                    fallback={<StatusBadge status="missing" label="Missing" tone="amber" />}
                  >
                    <StatusBadge status="stored" label="Stored" tone="surf" />
                  </Show>
                  <Show when={!row.required}>
                    <StatusBadge status="stored-only" label="Stored Only" tone="base" />
                  </Show>
                  <Show when={row.stored && row.readable}>
                    <StatusBadge status="readable" label="Readable" tone="cerulean" />
                  </Show>
                  <Button variant={row.stored ? 'ghost' : 'primary'} size="sm" onClick={() => openEditor(row.name)}>
                    {row.stored ? 'Reset' : 'Set'}
                  </Button>
                </div>
              </div>
            )}
          </For>
        </Show>
      </div>

      <Modal
        open={Boolean(editingRow())}
        onClose={closeEditor}
        title={editingRow()?.stored ? 'Reset Secret' : 'Set Secret'}
        size="md"
        footer={
          <>
            <Button variant="ghost" size="md" disabled={saving()} onClick={closeEditor}>Cancel</Button>
            <Button variant="primary" size="md" disabled={saving()} onClick={save}>
              {saving() ? 'Saving...' : 'Save'}
            </Button>
          </>
        }
      >
        <Show when={editingRow()}>
          {(row) => (
            <div>
              <div class="mb-4 border-2 border-base-600 bg-base-950 p-3">
                <div class="text-[10px] uppercase tracking-widest text-surf-300 font-bold">Name</div>
                <div class="font-mono text-[13px] text-base-50 mt-1 break-all">{row().name}</div>
              </div>

              <FormField label="New Value" required error={error() === 'Value is required' ? error() : undefined}>
                <input
                  class={formInputClass}
                  type="password"
                  autocomplete="new-password"
                  value={value()}
                  onInput={(e) => setValue(e.currentTarget.value)}
                />
              </FormField>

              <FormField label="Confirm Value" required error={error() === 'Values do not match' ? error() : undefined}>
                <input
                  class={formInputClass}
                  type="password"
                  autocomplete="new-password"
                  value={confirmValue()}
                  onInput={(e) => setConfirmValue(e.currentTarget.value)}
                />
              </FormField>

              <FormField label="Description">
                <input
                  class={formInputClass}
                  type="text"
                  value={description()}
                  onInput={(e) => setDescription(e.currentTarget.value)}
                />
              </FormField>

              <Show when={error() && error() !== 'Value is required' && error() !== 'Values do not match'}>
                <div class="text-[12px] text-scarlet-300 font-semibold mt-3">{error()}</div>
              </Show>
            </div>
          )}
        </Show>
      </Modal>
    </div>
  );
}
