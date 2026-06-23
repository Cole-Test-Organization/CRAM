import { createResource, createSignal, createEffect, Show, For } from 'solid-js';
import Modal, { modalBtn } from './Modal';
import { api } from '../lib/api';

// Generic, object-agnostic merge resolver. Given two record ids of the same
// `entity`, it fetches a plan from the server (POST /api/merge/:entity/preview)
// and renders a two-column "what to keep" form — radios for scalar fields,
// base|source|both for append fields (notes), checkboxes for relation
// collections (attendees). The BASE survives; the SOURCE is folded in and
// tombstoned. Direction is swappable. Nothing here is meeting-specific — it
// renders whatever the plan describes, so it works for any entity the backend
// registers a handler for.

interface MergeModalProps {
  open: boolean;
  entity: string;
  idA: number | null;
  idB: number | null;
  onClose: () => void;
  onMerged: () => void;
}

type Side = 'base' | 'source';
type BodyChoice = 'base' | 'source' | 'both';

function display(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

function truncate(v: unknown, n = 220): string {
  const s = v === null || v === undefined || v === '' ? '—' : String(v);
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export default function MergeModal(props: MergeModalProps) {
  // Direction: base = the keeper. Default base = first selected (idA).
  const [baseId, setBaseId] = createSignal<number | null>(null);
  const [sourceId, setSourceId] = createSignal<number | null>(null);

  // Reset the direction whenever the modal is (re)opened with a new pair.
  createEffect(() => {
    if (props.open) {
      setBaseId(props.idA);
      setSourceId(props.idB);
    }
  });

  const [plan, { mutate: mutatePlan }] = createResource(
    () => (props.open && baseId() && sourceId() ? { entity: props.entity, base: baseId()!, source: sourceId()! } : null),
    ({ entity, base, source }) => api.previewMerge(entity, base, source),
  );

  // Choices, reset each time a fresh plan arrives.
  const [fieldChoice, setFieldChoice] = createSignal<Record<string, Side>>({});
  const [bodyChoice, setBodyChoice] = createSignal<BodyChoice>('both');
  const [bring, setBring] = createSignal<Set<number | string>>(new Set());
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  createEffect(() => {
    const p = plan();
    if (!p) return;
    setFieldChoice({}); // default: keep base for every scalar
    setBodyChoice('both'); // default: append both
    // default: bring every source relation item
    const ids = new Set<number | string>();
    for (const c of p.collections || []) for (const it of c.source || []) ids.add(it.id);
    setBring(ids);
    setError(null);
  });

  const scalarFields = () => (plan()?.fields || []).filter((f: any) => f.kind === 'scalar');
  const bodyField = () => (plan()?.fields || []).find((f: any) => f.kind === 'append');

  const setField = (key: string, side: Side) => setFieldChoice((prev) => ({ ...prev, [key]: side }));
  const choiceFor = (key: string): Side => fieldChoice()[key] || 'base';
  const toggleBring = (id: number | string) =>
    setBring((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const swap = () => {
    const b = baseId();
    setBaseId(sourceId());
    setSourceId(b);
    mutatePlan(undefined); // force the resource to show loading while it refetches
  };

  const doMerge = async () => {
    if (!baseId() || !sourceId()) return;
    setSaving(true);
    setError(null);
    try {
      const fields: Record<string, Side> = {};
      for (const f of scalarFields()) if (choiceFor(f.key) === 'source') fields[f.key] = 'source';
      const collections: Record<string, (number | string)[]> = {};
      for (const c of plan()?.collections || []) {
        collections[c.key] = (c.source || []).filter((it: any) => bring().has(it.id)).map((it: any) => it.id);
      }
      await api.applyMerge(props.entity, baseId()!, sourceId()!, {
        fields,
        append: bodyField() ? { body: bodyChoice() } : {},
        collections,
      });
      props.onMerged();
      props.onClose();
    } catch (e: any) {
      setError(e?.message || 'Merge failed.');
    } finally {
      setSaving(false);
    }
  };

  // A selectable side card (used for scalar fields and the notes options).
  const SideOption = (p: { selected: boolean; onSelect: () => void; tag: string; children: any }) => (
    <label
      class={`flex-1 min-w-0 flex items-start gap-2 cursor-pointer border-2 p-2 transition-colors ${p.selected ? 'border-surf-300 bg-base-900' : 'border-base-700 bg-base-950 hover:border-base-500'}`}
      onClick={p.onSelect}
    >
      <input type="radio" checked={p.selected} onChange={p.onSelect} class="mt-0.5 w-4 h-4 accent-surf-300 shrink-0" />
      <span class="min-w-0 break-words">
        <span class="text-base-400 text-[10px] uppercase tracking-widest block mb-0.5">{p.tag}</span>
        <span class="text-[12px] text-base-50 break-words">{p.children}</span>
      </span>
    </label>
  );

  return (
    <Modal open={props.open} onClose={props.onClose} title="Merge records" size="lg"
      footer={
        <>
          <button class={modalBtn.secondary} onClick={props.onClose} disabled={saving()}>Cancel</button>
          <button class={modalBtn.primary} onClick={doMerge} disabled={saving() || plan.loading || !plan()}>
            {saving() ? 'Merging…' : 'Merge'}
          </button>
        </>
      }
    >
      <Show when={plan.error}>
        <div class="text-[12px] text-scarlet-400 font-semibold mb-3">Couldn't load the records to merge: {String((plan.error as any)?.message || plan.error)}</div>
      </Show>
      <Show when={plan.loading}>
        <div class="text-base-300 text-sm p-6 text-center">Loading…</div>
      </Show>

      <Show when={plan()}>
        {/* Direction header */}
        <div class="flex flex-col gap-2 mb-4 md:flex-row md:items-center md:gap-3">
          <div class="flex-1 min-w-0 border-2 border-surf-300 bg-base-900 p-2">
            <span class="text-surf-300 text-[10px] uppercase tracking-widest block">Base — kept</span>
            <span class="text-base-50 text-sm font-semibold break-words">{plan()!.base.label}</span>
          </div>
          <button class="press press-ghost press-sm shrink-0 self-center" onClick={swap} title="Swap which record survives">⇄ Swap</button>
          <div class="flex-1 min-w-0 border-2 border-base-600 bg-base-950 p-2">
            <span class="text-base-400 text-[10px] uppercase tracking-widest block">Source — folded in &amp; removed</span>
            <span class="text-base-200 text-sm break-words">{plan()!.source.label}</span>
          </div>
        </div>

        <p class="text-base-400 text-[11px] mb-4">The base record survives. Pick which value to keep for each field; the source is then tombstoned (recoverable). Defaults keep the base and append the source's notes.</p>

        {/* Scalar fields */}
        <div class="flex flex-col gap-3">
          <For each={scalarFields()}>
            {(f: any) => (
              <Show when={display(f.base) !== display(f.source)} fallback={
                <div class="border-2 border-base-800 bg-base-950 p-2 opacity-70">
                  <span class="text-base-400 text-[10px] uppercase tracking-widest">{f.label}</span>
                  <span class="text-[12px] text-base-200 ml-2 break-words">{display(f.base)} <span class="text-base-500">(same)</span></span>
                </div>
              }>
                <div class="border-2 border-base-700 bg-base-950 p-3">
                  <div class="text-[10px] text-surf-300 mb-2 font-bold uppercase tracking-widest">{f.label}</div>
                  <div class="flex flex-col md:flex-row gap-2">
                    <SideOption selected={choiceFor(f.key) === 'base'} onSelect={() => setField(f.key, 'base')} tag="Base">{display(f.base)}</SideOption>
                    <SideOption selected={choiceFor(f.key) === 'source'} onSelect={() => setField(f.key, 'source')} tag="Source">{display(f.source)}</SideOption>
                  </div>
                </div>
              </Show>
            )}
          </For>

          {/* Notes (append) */}
          <Show when={bodyField()}>
            <div class="border-2 border-base-700 bg-base-950 p-3">
              <div class="text-[10px] text-surf-300 mb-2 font-bold uppercase tracking-widest">{bodyField()!.label}</div>
              <div class="flex flex-col gap-2">
                <SideOption selected={bodyChoice() === 'both'} onSelect={() => setBodyChoice('both')} tag="Both — base, then source appended">
                  <span class="text-base-400">Keep everything from both.</span>
                </SideOption>
                <SideOption selected={bodyChoice() === 'base'} onSelect={() => setBodyChoice('base')} tag="Base only">{truncate(bodyField()!.base)}</SideOption>
                <SideOption selected={bodyChoice() === 'source'} onSelect={() => setBodyChoice('source')} tag="Source only">{truncate(bodyField()!.source)}</SideOption>
              </div>
            </div>
          </Show>

          {/* Collections (e.g. attendees) */}
          <For each={plan()!.collections || []}>
            {(c: any) => (
              <Show when={(c.source || []).length > 0}>
                <div class="border-2 border-base-700 bg-base-950 p-3">
                  <div class="text-[10px] text-surf-300 mb-2 font-bold uppercase tracking-widest">Bring {c.label} from source</div>
                  <Show when={(c.base || []).length > 0}>
                    <div class="text-[11px] text-base-400 mb-2">Base already has: {(c.base as any[]).map((i) => i.label).join(', ')}</div>
                  </Show>
                  <div class="flex flex-col gap-1.5">
                    <For each={c.source}>
                      {(it: any) => (
                        <label class="flex items-center gap-2 cursor-pointer text-[12px] text-base-100">
                          <input type="checkbox" class="w-4 h-4 accent-surf-300" checked={bring().has(it.id)} onChange={() => toggleBring(it.id)} />
                          {it.label}
                        </label>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            )}
          </For>
        </div>

        <Show when={error()}>
          <div class="text-[12px] text-scarlet-400 mt-3 font-semibold">{error()}</div>
        </Show>
      </Show>
    </Modal>
  );
}
