import { createResource, createSignal, createMemo, For, Show } from 'solid-js';
import { A, useNavigate } from '@solidjs/router';
import { api } from '../lib/api';
import { OpportunityFormModal } from '../components/FormModals';
import Button from '../components/Button';
import { STAGES, STAGE_BY_ID, stageShort, stageChipClass, type OpportunityStage } from '../lib/stages';

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function OpportunitiesList() {
  const [filter, setFilter] = createSignal('');
  const [stageFilter, setStageFilter] = createSignal('');
  const [modalOpen, setModalOpen] = createSignal(false);
  const navigate = useNavigate();

  const [data, { refetch }] = createResource(
    () => ({ stage: stageFilter() }),
    (params) => api.getOpportunities({ stage: params.stage || undefined, sort: 'created_at', order: 'desc', limit: 500 })
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

  return (
    <div>
      <div class="flex flex-col gap-3 mb-6 md:flex-row md:justify-between md:items-center">
        <h1 class="text-[26px] font-bold font-[family-name:var(--font-display)]">Opportunities</h1>
        <div class="flex items-center gap-3 flex-wrap">
          <span class="text-base-300 text-[12px] uppercase tracking-wider">
            {filtered().length} opps
          </span>
          <Button variant="primary" onClick={() => setModalOpen(true)}>+ New Opportunity</Button>
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

      <div class="panel panel-accent">
        <Show when={!data.loading} fallback={<div class="text-base-300 p-10 text-center">Loading...</div>}>
          <For each={filtered()} fallback={
            <div class="text-base-300 text-center p-10 text-sm">
              No opportunities yet. <button class="text-surf-300 underline" onClick={() => setModalOpen(true)}>Create the first one</button>.
            </div>
          }>
            {(opp: any) => (
              <A href={`/opportunities/${opp.id}`} class="press-row gap-4 flex-wrap border-b border-base-700 last:border-b-0">
                <span class="flex-1 min-w-[60%] md:min-w-[280px] font-semibold text-sm text-base-50">{opp.name}</span>
                <Show when={opp.account_name}>
                  <span class="text-base-300 text-[12px]">{opp.account_name}</span>
                </Show>
                <span class={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 border ${stageChipClass(opp.stage)}`}>
                  {stageShort(opp.stage)}
                </span>
                <span class="text-base-400 text-[11px]">{formatShortDate(opp.created_at)}</span>
              </A>
            )}
          </For>
        </Show>
      </div>

      <OpportunityFormModal
        open={modalOpen()}
        onClose={() => setModalOpen(false)}
        onSaved={(opp) => {
          refetch();
          navigate(`/opportunities/${opp.id}`);
        }}
      />
    </div>
  );
}
