import { A } from '@solidjs/router';
import { createMemo, createResource, createSignal, For, Show } from 'solid-js';
import { api } from '../../lib/api';
import type { OrgChartNode } from '../../lib/types';

type Props = {
  accountId: number;
};

// Fixed node-card geometry for the flow-chart layout. Cards are absolutely
// positioned on a scrollable canvas, so these drive both layout math and CSS.
const NODE_W = 240;
const NODE_H = 112;
const H_GAP = 32;
const V_GAP = 56;
const EDGE_COLOR = 'var(--color-base-400)';

type PlacedNode = { node: OrgChartNode; x: number; y: number };
type LayoutEdge = { from: PlacedNode; to: PlacedNode };

function personLabel(node: OrgChartNode) {
  return node.full_name || node.email || `Contact ${node.id}`;
}

function personMeta(node: OrgChartNode) {
  return [node.title, node.email].filter(Boolean).join(' • ');
}

// Orthogonal elbow connector from the manager's bottom edge to the report's
// top edge; the endpoint stops 1px short so the arrowhead isn't painted over
// by the card border (cards render above the SVG).
function edgePath(from: PlacedNode, to: PlacedNode) {
  const fromX = from.x + NODE_W / 2;
  const fromY = from.y + NODE_H;
  const toX = to.x + NODE_W / 2;
  const toY = to.y - 1;
  const midY = fromY + (toY - fromY) / 2;
  return `M ${fromX} ${fromY} L ${fromX} ${midY} L ${toX} ${midY} L ${toX} ${toY}`;
}

export default function OrgChartPanel(props: Props) {
  const [chart, { mutate }] = createResource(() => props.accountId, (accountId) => api.getOrgChart(accountId));
  const [savingId, setSavingId] = createSignal<number | null>(null);

  const nodes = createMemo(() => chart()?.nodes || []);
  const nodeIds = createMemo(() => new Set(nodes().map((node) => node.id)));
  const edgeMap = createMemo(() => new Map((chart()?.edges || []).map((edge) => [edge.contact_id, edge.reports_to_contact_id])));

  const childrenByManager = createMemo(() => {
    const byManager = new Map<number | null, OrgChartNode[]>();
    for (const node of nodes()) {
      const managerId = edgeMap().get(node.id) ?? null;
      const key = managerId != null && nodeIds().has(managerId) ? managerId : null;
      const children = byManager.get(key) || [];
      children.push(node);
      byManager.set(key, children);
    }
    for (const children of byManager.values()) {
      children.sort((a, b) => personLabel(a).localeCompare(personLabel(b)));
    }
    return byManager;
  });

  // A node has no resolvable manager → it renders as a root of its own tree.
  const isRoot = (nodeId: number) => {
    const managerId = edgeMap().get(nodeId);
    return managerId == null || !nodeIds().has(managerId);
  };

  const descendantsOf = (nodeId: number) => {
    const descendants = new Set<number>();
    const visit = (id: number) => {
      for (const child of childrenByManager().get(id) || []) {
        if (descendants.has(child.id)) continue;
        descendants.add(child.id);
        visit(child.id);
      }
    };
    visit(nodeId);
    return descendants;
  };

  // Tidy-tree layout: leaves take sequential x slots, parents center over
  // their children, depth sets y. Sibling subtrees occupy disjoint slot
  // ranges, so cards can never overlap. Nodes already placed are skipped when
  // descending (breaks manager cycles in bad data instead of recursing
  // forever); anything still unplaced after the root pass is laid out as an
  // extra root so no contact silently disappears from the chart.
  const layout = createMemo(() => {
    const byManager = childrenByManager();
    const placed = new Map<number, PlacedNode>();
    const ordered: PlacedNode[] = [];
    let cursor = 0;
    let maxDepth = 0;

    const place = (node: OrgChartNode, depth: number): number => {
      const entry: PlacedNode = { node, x: 0, y: depth * (NODE_H + V_GAP) };
      placed.set(node.id, entry);
      ordered.push(entry);
      maxDepth = Math.max(maxDepth, depth);
      const children = (byManager.get(node.id) || []).filter((child) => !placed.has(child.id));
      let centerX: number;
      if (children.length === 0) {
        centerX = cursor + NODE_W / 2;
        cursor += NODE_W + H_GAP;
      } else {
        const centers = children.map((child) => place(child, depth + 1));
        centerX = (centers[0] + centers[centers.length - 1]) / 2;
      }
      entry.x = centerX - NODE_W / 2;
      return centerX;
    };

    for (const root of byManager.get(null) || []) place(root, 0);
    for (const node of nodes()) if (!placed.has(node.id)) place(node, 0);

    const edges: LayoutEdge[] = [];
    for (const entry of ordered) {
      const managerId = edgeMap().get(entry.node.id);
      const from = managerId != null ? placed.get(managerId) : undefined;
      if (from) edges.push({ from, to: entry });
    }

    return {
      nodes: ordered,
      edges,
      width: ordered.length ? cursor - H_GAP : 0,
      height: ordered.length ? (maxDepth + 1) * NODE_H + maxDepth * V_GAP : 0,
    };
  });

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
            {/* Canvas is fixed-size and pans inside the panel, so wide trees
                scroll horizontally instead of overflowing the page (mobile). */}
            <div class="overflow-x-auto">
              <div
                class="relative"
                style={{ width: `${layout().width + 4}px`, height: `${layout().height + 4}px` }}
              >
                <svg
                  class="pointer-events-none absolute inset-0"
                  width={layout().width + 4}
                  height={layout().height + 4}
                  aria-hidden="true"
                >
                  <defs>
                    <marker id="org-edge-arrow" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                      <path d="M 0 0 L 8 4 L 0 8 z" fill={EDGE_COLOR} />
                    </marker>
                  </defs>
                  <For each={layout().edges}>
                    {(edge) => (
                      <path
                        data-org-edge
                        d={edgePath(edge.from, edge.to)}
                        fill="none"
                        stroke={EDGE_COLOR}
                        stroke-width="2"
                        marker-end="url(#org-edge-arrow)"
                      />
                    )}
                  </For>
                </svg>
                <For each={layout().nodes}>
                  {(placedNode) => {
                    const node = placedNode.node;
                    const disallowedManagers = descendantsOf(node.id);
                    disallowedManagers.add(node.id);
                    return (
                      <div
                        data-org-node={String(node.id)}
                        class="absolute flex flex-col justify-between gap-1.5 border-2 border-base-600 bg-base-900 px-2.5 py-2"
                        classList={{ 'border-t-[3px] border-t-surf-500': isRoot(node.id) }}
                        style={{
                          left: `${placedNode.x}px`,
                          top: `${placedNode.y}px`,
                          width: `${NODE_W}px`,
                          height: `${NODE_H}px`,
                          'box-shadow': '2px 2px 0 0 var(--color-base-700)',
                        }}
                      >
                        <div class="min-w-0">
                          <A
                            href={`/contacts/${node.id}`}
                            class="block truncate text-[13px] font-semibold text-base-50 hover:text-surf-300"
                            title={personLabel(node)}
                          >
                            {personLabel(node)}
                          </A>
                          <Show when={personMeta(node)}>
                            <div class="truncate text-[11px] text-base-300" title={personMeta(node)}>
                              {personMeta(node)}
                            </div>
                          </Show>
                        </div>
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
                    );
                  }}
                </For>
              </div>
            </div>
          </div>
        </Show>
      </div>
    </Show>
  );
}
