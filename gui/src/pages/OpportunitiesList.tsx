import { createResource, createSignal, createMemo, For, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { api } from '../lib/api';
import { OpportunityFormModal } from '../components/FormModals';
import Button from '../components/Button';
import ListRows from '../components/ListRows';
import SelectionToolbar from '../components/SelectionToolbar';
import { createSelection } from '../components/createSelection';
import { buildOpportunitiesExport } from '../lib/opportunityExport';
import { STAGES, STAGE_BY_ID, stageShort, stageChipClass, type OpportunityStage } from '../lib/stages';

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

type Props = {
  // When set, scopes the list to this account's opportunities (same endpoint,
  // additional filter) and pins the New Opportunity modal. Standalone
  // /opportunities page mode when unset: shows the H1, the account column,
  // and navigates to the new opportunity after creation.
  accountId?: number;
  accountName?: string;
  onAfterCreate?: (opp: any) => void;
  onAfterDelete?: () => void;
};

export default function OpportunitiesList(props: Props = {}) {
  const [filter, setFilter] = createSignal('');
  const [stageFilter, setStageFilter] = createSignal('');
  const [modalOpen, setModalOpen] = createSignal(false);
  const navigate = useNavigate();

  const isEmbedded = () => props.accountId !== undefined && props.accountId !== null;

  const [data, { refetch }] = createResource(
    () => ({ accountId: props.accountId, stage: stageFilter() }),
    async ({ accountId, stage }) =>
      api.getOpportunities({
        account_id: accountId,
        stage: stage || undefined,
        sort: 'created_at',
        order: 'desc',
        limit: 500,
      }),
  );

  const stageIndex = (s: string | null | undefined) =>
    STAGE_BY_ID[s as OpportunityStage]?.index ?? 999;
  const isTerminal = (s: string | null | undefined) =>
    !!STAGE_BY_ID[s as OpportunityStage]?.terminal;

  const filtered = createMemo(() => {
    const q = filter().toLowerCase();
    const stage = stageFilter();
    const opps = data()?.opportunities || [];
    const result = opps.filter((o: any) => {
      if (!stage && isTerminal(o.stage)) return false;
      if (!q) return true;
      return (
        o.name.toLowerCase().includes(q) ||
        (o.account_name && o.account_name.toLowerCase().includes(q)) ||
        (o.account_slug && o.account_slug.toLowerCase().includes(q))
      );
    });
    return result.slice().sort((a: any, b: any) => stageIndex(a.stage) - stageIndex(b.stage));
  });

  const sel = createSelection(
    () => filtered().map((o: any) => o.id),
    () => props.accountId,
  );

  const buildExport = (ids: number[]) => {
    const idSet = new Set(ids);
    const items = (data()?.opportunities || []).filter((o: any) => idSet.has(o.id));
    return buildOpportunitiesExport(items);
  };

  const deleteOpportunity = async (id: number) => {
    if (!confirm('Delete this opportunity?')) return;
    await api.deleteOpportunity(id);
    sel.remove(id);
    refetch();
    props.onAfterDelete?.();
  };

  return (
    <div>
      <div class="flex flex-col gap-3 mb-6 md:flex-row md:items-center">
        <Show when={!isEmbedded()}>
          <h1 class="text-[26px] font-bold font-[family-name:var(--font-display)]">Opportunities</h1>
        </Show>
        <div class="flex items-center gap-3 flex-wrap md:ml-auto">
          <span class="text-base-300 text-[12px] uppercase tracking-wider">
            {filtered().length} opp{filtered().length === 1 ? '' : 's'}
          </span>
          <Button variant="primary" size={isEmbedded() ? 'sm' : 'md'} onClick={() => setModalOpen(true)}>+ New Opportunity</Button>
        </div>
      </div>

      <div class="flex gap-3 mb-5 flex-wrap">
        <div class="flex items-center bg-base-950 border-2 border-base-500 px-3 py-2 gap-2 flex-1 min-w-[200px] focus-within:border-surf-300 transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-surf-400"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input
            type="text"
            placeholder="Filter opportunities..."
            value={filter()}
            onInput={(e) => setFilter(e.currentTarget.value)}
            class="flex-1 bg-transparent border-none outline-none text-base-50 text-sm placeholder:text-base-400"
          />
        </div>
        <select
          class="input-vintage cursor-pointer flex-none"
          style="width: auto; min-width: 200px;"
          value={stageFilter()}
          onChange={(e) => setStageFilter(e.currentTarget.value)}
        >
          <option value="">All stages</option>
          <For each={STAGES}>
            {(s) => <option value={s.id}>{s.label}</option>}
          </For>
        </select>
      </div>

      <SelectionToolbar selection={sel} buildExport={buildExport} loading={() => data.loading} />

      <ListRows
        items={filtered}
        loading={() => data.loading}
        getId={(o: any) => o.id}
        getHref={(o: any) => `/opportunities/${o.id}`}
        renderRow={(opp: any) => (
          <>
            <span class="flex-1 min-w-full md:min-w-[280px] font-semibold text-sm text-base-50">{opp.name}</span>
            <Show when={!isEmbedded() && opp.account_name}>
              <span class="text-base-300 text-[12px]">{opp.account_name}</span>
            </Show>
            <span class={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 border ${stageChipClass(opp.stage)}`}>
              {stageShort(opp.stage)}
            </span>
            <Show when={typeof opp.product_count === 'number'}>
              <span class="text-surf-300 text-[11px] uppercase tracking-wider">{opp.product_count} prod{opp.product_count === 1 ? '' : 's'}</span>
            </Show>
            <span class="text-base-400 text-[11px]">{formatShortDate(opp.created_at)}</span>
          </>
        )}
        selection={sel}
        onDelete={deleteOpportunity}
        deleteTitle="Delete opportunity"
        emptyState={
          <div class="text-base-300 text-center p-10 text-sm">
            No opportunities yet. <button class="text-surf-300 underline" onClick={() => setModalOpen(true)}>Create the first one</button>.
          </div>
        }
      />

      <OpportunityFormModal
        open={modalOpen()}
        onClose={() => setModalOpen(false)}
        fixedAccountId={props.accountId}
        fixedAccountName={props.accountName}
        onSaved={(opp) => {
          refetch();
          if (props.onAfterCreate) {
            props.onAfterCreate(opp);
          } else {
            navigate(`/opportunities/${opp.id}`);
          }
        }}
      />
    </div>
  );
}
