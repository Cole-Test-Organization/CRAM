import { createMemo, createResource, createSignal, For, Show } from 'solid-js';
import Button from '../Button';
import StatusBadge from '../StatusBadge';
import {
  api,
  type ProvisioningCredentialReport,
  type ProvisioningCredentialState,
  type ProvisioningReconciledResource,
  type ProvisioningReconciliationReport,
  type StoredProvisioningReconciliationReport,
} from '../../lib/api';
import { formatDateTime, formatRelative } from '../../utils/date';

// Broker state only records what the broker itself provisioned, so anything torn down
// outside it (console, CLI sweep, an expired lab) keeps reading as live. This panel shows
// the drift check and keeps the two failure modes visually distinct: an expired cloud
// login is a credentials problem and proves nothing about the machines.
//
// A live sweep costs one cloud CLI call per resource, serially, so this renders the LAST
// STORED report (a background task refreshes it on an interval) and surfaces how old that
// answer is. "Check now" forces a fresh sweep for when the operator knows something just
// changed. Applying stays manual — the timer never writes lifecycle state.

const CREDENTIAL_TONE: Record<ProvisioningCredentialState, 'surf' | 'amber' | 'scarlet' | 'base'> = {
  ok: 'surf',
  expired: 'amber',
  missing: 'amber',
  denied: 'scarlet',
  error: 'scarlet',
  unsupported: 'base',
};

const RESOURCE_TONE = {
  present: 'surf',
  missing: 'scarlet',
  'credentials-invalid': 'amber',
  unknown: 'cerulean',
  unsupported: 'base',
} as const;

export default function ReconcilePanel(props: {
  /** Limit the check to one deployment; omit for the whole broker. */
  deployment?: string;
  /** Called after an apply so the caller can refresh its resource list. */
  onApplied?: () => void;
}) {
  // Live result of a sweep this session, if one has been run. Null means "show the
  // stored report instead" — which is the normal case on load.
  const [fresh, setFresh] = createSignal<ProvisioningReconciliationReport | null>(null);
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal('');
  const [expanded, setExpanded] = createSignal(false);

  const scope = () => (props.deployment ? { deployment: props.deployment } : undefined);

  // Cheap read of the last stored sweep — one indexed row, no cloud calls, so it is
  // safe to do on mount. A failure here is not worth an error banner: the panel just
  // falls back to its "nothing checked yet" state and the button still works.
  const [stored, { refetch: refetchStored }] = createResource(
    () => props.deployment ?? '',
    (deployment) =>
      api
        .lastProvisioningReconcile(deployment ? { deployment } : undefined)
        .catch(() => null) as Promise<StoredProvisioningReconciliationReport | null>,
  );

  const report = (): ProvisioningReconciliationReport | null => fresh() ?? stored() ?? null;
  const isStored = () => !fresh() && Boolean(stored());

  const run = async (mode: 'check' | 'apply') => {
    setBusy(mode);
    setError('');
    try {
      const next = mode === 'apply'
        ? await api.applyProvisioningReconcile(scope())
        : await api.reconcileProvisioning(scope());
      setFresh(next);
      setExpanded(true);
      // The run was persisted server-side; keep the stored copy in step so a later
      // remount shows this result rather than the pre-sweep one.
      void refetchStored();
      if (mode === 'apply') props.onApplied?.();
    } catch (err: any) {
      setError(err?.message || 'Reconciliation failed');
    } finally {
      setBusy('');
    }
  };

  const staleCount = () => report()?.summary.stale ?? 0;
  const blockedCount = () => report()?.summary.credentialsInvalid ?? 0;
  const badCredentials = createMemo(() =>
    (report()?.credentials ?? []).filter((c) => c.state !== 'ok' && c.state !== 'unsupported'),
  );
  const notable = createMemo(() =>
    (report()?.resources ?? []).filter((r) => r.status !== 'present'),
  );

  return (
    <div class="panel panel-accent p-4">
      <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div class="min-w-0">
          <h2 class="text-[14px] font-bold uppercase tracking-widest text-surf-300">Cloud Reconciliation</h2>
          <div class="text-base-400 text-[12px] mt-1">
            <Show
              when={report()}
              fallback={
                stored.loading
                  ? 'Loading the last drift check...'
                  : 'No drift check has run yet. Check now to ask each cloud what still exists.'
              }
            >
              {(r) => (
                <span>
                  {r().summary.checked} checked · {r().summary.present} present · {r().summary.missing} gone
                  <Show when={r().summary.markedDestroyed}>
                    {' '}· {r().summary.markedDestroyed} marked destroyed
                  </Show>
                  {' '}·{' '}
                  <span title={formatDateTime(r().checkedAt)}>
                    checked {formatRelative(r().checkedAt)}
                  </span>
                  <Show when={isStored()}>
                    <span class="text-base-500">
                      {' '}({stored()?.source === 'scheduled' ? 'background sweep' : 'last manual check'})
                    </span>
                  </Show>
                </span>
              )}
            </Show>
          </div>
        </div>
        <div class="flex gap-2 flex-wrap">
          <Button variant="ghost" size="sm" disabled={Boolean(busy())} onClick={() => run('check')}>
            {busy() === 'check' ? 'Checking...' : 'Check now'}
          </Button>
          <Show when={staleCount() > 0}>
            <Button
              variant="danger"
              size="sm"
              disabled={Boolean(busy())}
              onClick={() => {
                if (!confirm(`Mark ${staleCount()} resource(s) destroyed? They no longer exist in the cloud.`)) return;
                void run('apply');
              }}
            >
              {busy() === 'apply' ? 'Cleaning...' : `Clean up ${staleCount()} stale`}
            </Button>
          </Show>
        </div>
      </div>

      <Show when={error()}>
        <div class="text-[12px] text-scarlet-300 font-semibold mt-3 break-words">{error()}</div>
      </Show>

      <Show when={badCredentials().length}>
        <div class="mt-4 border-2 border-amber-300/60 bg-amber-300/10 p-3">
          <div class="text-[11px] uppercase tracking-widest font-bold text-amber-300">
            Credentials need attention
          </div>
          <div class="text-[12px] text-base-200 mt-1">
            Resources under these logins could not be checked — that is not evidence they were torn down.
          </div>
          <For each={badCredentials()}>{(cred) => <CredentialRow credential={cred} />}</For>
        </div>
      </Show>

      <Show when={report() && !badCredentials().length}>
        <div class="mt-3 flex gap-2 flex-wrap">
          <For each={report()!.credentials}>
            {(cred) => (
              <span class="text-[11px] text-base-300 border border-base-600 px-2 py-1 break-all">
                {cred.scope} <span class="text-surf-300">ok</span>
              </span>
            )}
          </For>
        </div>
      </Show>

      <Show when={report() && notable().length}>
        <div class="mt-4">
          <button
            type="button"
            class="text-[11px] uppercase tracking-widest text-surf-300 hover:underline"
            onClick={() => setExpanded(!expanded())}
          >
            {expanded() ? 'Hide' : 'Show'} {notable().length} resource{notable().length === 1 ? '' : 's'} needing attention
            <Show when={blockedCount()}> ({blockedCount()} blocked on credentials)</Show>
          </button>
          <Show when={expanded()}>
            <div class="mt-2 border-2 border-base-600">
              <For each={notable()}>{(resource) => <ResourceRow resource={resource} />}</For>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={report() && !notable().length}>
        <div class="text-[12px] text-surf-300 mt-3">
          Everything tracked still exists — no stale records.
        </div>
      </Show>
    </div>
  );
}

function CredentialRow(props: { credential: ProvisioningCredentialReport }) {
  return (
    <div class="flex flex-col gap-1 mt-2 pt-2 border-t border-amber-300/30 first:border-t-0 first:pt-0">
      <div class="flex gap-2 items-center flex-wrap">
        <StatusBadge status={props.credential.state} tone={CREDENTIAL_TONE[props.credential.state]} />
        <span class="font-mono text-[11px] text-base-200 break-all">{props.credential.scope}</span>
        <Show when={props.credential.providerProfiles.length}>
          <span class="text-[11px] text-base-400 uppercase tracking-wider">
            {props.credential.providerProfiles.join(', ')}
          </span>
        </Show>
      </div>
      <Show when={props.credential.remediation}>
        <div class="text-[12px] text-amber-200 break-words">{props.credential.remediation}</div>
      </Show>
      <Show when={props.credential.detail}>
        <div class="text-[11px] text-base-400 break-words">{props.credential.detail}</div>
      </Show>
    </div>
  );
}

function ResourceRow(props: { resource: ProvisioningReconciledResource }) {
  return (
    <div class="press-row gap-3 flex-wrap border-b border-base-700 last:border-b-0">
      <div class="flex-1 min-w-[58%]">
        <div class="text-sm text-base-50 font-semibold break-words">
          {props.resource.hostname}
          <Show when={props.resource.applied}>
            <span class="text-[11px] text-scarlet-300 font-normal ml-2 uppercase tracking-wider">marked destroyed</span>
          </Show>
        </div>
        <div class="flex gap-2 flex-wrap text-[11px] text-base-400 uppercase tracking-wider mt-1">
          <span>{props.resource.deploymentId}</span>
          <span>{props.resource.kind || 'resource'}</span>
          <span>{props.resource.provider || 'unknown'}</span>
        </div>
        <Show when={props.resource.detail}>
          <div class="text-[11px] text-base-300 mt-1 break-words">{props.resource.detail}</div>
        </Show>
      </div>
      <div class="w-full md:w-auto">
        <StatusBadge status={props.resource.status} tone={RESOURCE_TONE[props.resource.status]} />
      </div>
    </div>
  );
}
