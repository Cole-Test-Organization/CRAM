import { A } from '@solidjs/router';
import { createMemo, createResource, createSignal, For, Show } from 'solid-js';
import { api } from '../../lib/api';
import type { OrgChartNode } from '../../lib/types';

type Props = {
  accountId: number;
};

function personLabel(node: OrgChartNode) {
  return node.full_name || node.email || `Contact ${node.id}`;
}

function personMeta(node: OrgChartNode) {
  return [node.title, node.email].filter(Boolean).join(' • ');
}

export default function OrgChartPanel(props: Props) {
  const [chart, { mutate }] = createResource(() => props.accountId, (accountId) => api.getOrgChart(accountId));
  const [savingId, setSavingId] = createSignal<number | null>(null);

  const nodes = createMemo(() => chart()?.nodes || []);
  const edgeMap = createMemo(() => new Map((chart()?.edges || []).map((edge) => [edge.contact_id, edge.reports_to_contact_id])));

  const childrenByManager = createMemo(() => {
    const byManager = new Map<number | null, OrgChartNode[]>();
    const nodeIds = new Set(nodes().map((node) => node.id));
    for (const node of nodes()) {
      const managerId = edgeMap().get(node.id) ?? null;
      const key = managerId != null && nodeIds.has(managerId) ? managerId : null;
      const children = byManager.get(key) || [];
      children.push(node);
      byManager.set(key, children);
    }
    for (const children of byManager.values()) {
      children.sort((a, b) => personLabel(a).localeCompare(personLabel(b)));
    }
    return byManager;
  });

  const descendantsOf = (nodeId: number) => {
    const descendants = new Set<number>();
    const visit = (id: number) => {
      for (const child of childrenByManager().get(id) || []) {
        descendants.add(child.id);
        visit(child.id);
      }
    };
    visit(nodeId);
    return descendants;
  };

  const setManager = async (node: OrgChartNode, rawValue: string) => {
    const managerId = rawValue ? Number(rawValue) : null;
    setSavingId(node.id);
    try {
      const updated = await api.setOrgChartManager(props.accountId, node.id, managerId);
      mutate(updated);
    } catch (err: any) {
      alert(err?.message || 'Unable to update org chart');
    } finally {
      setSavingId(null);
    }
  };

  const renderNode = (node: OrgChartNode, depth: number) => {
    const disallowedManagers = descendantsOf(node.id);
    disallowedManagers.add(node.id);
    return (
      <div class="min-w-0">
        <div
          class="flex flex-col gap-3 border-2 border-base-600 bg-base-900 px-3 py-3 md:flex-row md:items-center"
          style={{
            'margin-left': `${Math.min(depth, 5) * 14}px`,
            'box-shadow': '2px 2px 0 0 var(--color-base-700)',
          }}
        >
          <div class="flex-1 min-w-0">
            <A href={`/contacts/${node.id}`} class="block text-sm font-semibold text-base-50 hover:text-surf-300 truncate">
              {personLabel(node)}
            </A>
            <Show when={personMeta(node)}>
              <div class="text-[12px] text-base-300 truncate">{personMeta(node)}</div>
            </Show>
          </div>
          <div class="w-full md:w-[260px]">
            <select
              class="input-vintage"
              value={String(edgeMap().get(node.id) ?? '')}
              disabled={savingId() === node.id}
              onChange={(event) => setManager(node, event.currentTarget.value)}
              aria-label={`Manager for ${personLabel(node)}`}
            >
              <option value="">Root</option>
              <For each={nodes().filter((candidate) => !disallowedManagers.has(candidate.id))}>
                {(candidate) => <option value={String(candidate.id)}>{personLabel(candidate)}</option>}
              </For>
            </select>
          </div>
        </div>
        <div class="mt-3 flex flex-col gap-3">
          <For each={childrenByManager().get(node.id) || []}>
            {(child) => renderNode(child, depth + 1)}
          </For>
        </div>
      </div>
    );
  };

  return (
    <Show when={!chart.loading} fallback={<div class="text-base-300 p-10 text-center">Loading...</div>}>
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <h2 class="text-[20px] font-bold font-[family-name:var(--font-display)]">Org Chart</h2>
          <span class="text-base-300 text-[12px] uppercase tracking-wider">
            {nodes().length} contact{nodes().length === 1 ? '' : 's'}
          </span>
        </div>

        <Show
          when={nodes().length > 0}
          fallback={<div class="panel panel-accent text-base-300 text-center p-10 text-sm">No contacts found</div>}
        >
          <div class="panel panel-accent p-3 md:p-4">
            <div class="flex flex-col gap-3">
              <For each={childrenByManager().get(null) || []}>
                {(node) => renderNode(node, 0)}
              </For>
            </div>
          </div>
        </Show>
      </div>
    </Show>
  );
}
