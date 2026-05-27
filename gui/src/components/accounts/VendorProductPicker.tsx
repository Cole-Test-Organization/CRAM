import { createSignal, createResource, For, Show, createMemo } from 'solid-js';
import { api } from '../../lib/api';
import { formInputClass } from '../FormField';
import { modalBtn } from '../Modal';
import type { VendorProduct } from '../../lib/types';

interface VendorProductPickerProps {
  // Currently selected products (full objects, so we can render names without
  // a separate lookup per render).
  value: VendorProduct[];
  // Free-text category — must match the `category` field on the product
  // (firewall, edr, siem, …). The picker scopes both its option list and any
  // newly created products to this category.
  category: string;
  // Called with the new full selection (array of products).
  onChange: (next: VendorProduct[]) => void;
  placeholder?: string;
}

function slugify(s: string) {
  return s.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export default function VendorProductPicker(props: VendorProductPickerProps) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [mode, setMode] = createSignal<'pick' | 'create'>('pick');
  const [options, { refetch }] = createResource(
    () => props.category,
    (cat) => api.getVendorProducts({ category: cat, limit: 500 })
  );

  const [newVendor, setNewVendor] = createSignal('');
  const [newProduct, setNewProduct] = createSignal('');
  const [createError, setCreateError] = createSignal('');
  const [creating, setCreating] = createSignal(false);

  const selectedIds = createMemo(() => new Set(props.value.map((p) => p.id)));

  const filtered = createMemo(() => {
    const list = options()?.products || [];
    const q = query().toLowerCase().trim();
    if (!q) return list;
    return list.filter((p: VendorProduct) =>
      p.name.toLowerCase().includes(q) || p.vendor_name.toLowerCase().includes(q)
    );
  });

  const toggle = (product: VendorProduct) => {
    if (selectedIds().has(product.id)) {
      props.onChange(props.value.filter((p) => p.id !== product.id));
    } else {
      props.onChange([...props.value, product]);
    }
  };

  const startCreate = () => {
    setMode('create');
    // Best-effort split — if the user typed "Palo Alto PA-3220", seed vendor + product.
    const q = query().trim();
    if (q.includes(' ')) {
      const [first, ...rest] = q.split(/\s+/);
      setNewVendor(first);
      setNewProduct(rest.join(' '));
    } else {
      setNewVendor('');
      setNewProduct(q);
    }
    setCreateError('');
  };

  const cancelCreate = () => {
    setMode('pick');
    setNewVendor('');
    setNewProduct('');
    setCreateError('');
  };

  const submitCreate = async () => {
    if (!newVendor().trim()) { setCreateError('Vendor is required'); return; }
    if (!newProduct().trim()) { setCreateError('Product name is required'); return; }
    setCreating(true);
    setCreateError('');
    try {
      const { product } = await api.findOrCreateVendorProduct({
        vendor_name: newVendor().trim(),
        name: newProduct().trim(),
        slug: slugify(newProduct()),
        category: props.category,
      });
      await refetch();
      // Add to selection if not already there (find_or_create may have
      // returned an existing product the user happened to re-create by name).
      if (!selectedIds().has(product.id)) {
        props.onChange([...props.value, product]);
      }
      setMode('pick');
      setQuery('');
      setNewVendor('');
      setNewProduct('');
    } catch (err: any) {
      setCreateError(err?.message || 'Failed to create');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div class="relative">
      <button
        type="button"
        class="input-vintage text-left flex items-center justify-between cursor-pointer min-h-[2.25rem]"
        onClick={() => setOpen(!open())}
      >
        <span class={`flex-1 ${props.value.length > 0 ? 'text-base-50' : 'text-base-400'} text-left`}>
          <Show when={props.value.length > 0} fallback={props.placeholder || `Add ${props.category}...`}>
            {props.value.map((p) => `${p.vendor_name} ${p.name}`.trim()).join(', ')}
          </Show>
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-surf-400 shrink-0 ml-2">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      <Show when={open()}>
        <div class="absolute left-0 right-0 top-full mt-1 z-50 bg-base-900 border-2 border-base-500 shadow-[4px_4px_0_0_var(--color-base-600)] max-h-[360px] flex flex-col">
          <Show when={mode() === 'pick'} fallback={
            <div class="p-3">
              <div class="text-[10px] uppercase text-surf-300 tracking-widest font-bold mb-2">New {props.category}</div>
              <input
                class={`${formInputClass} mb-2`}
                placeholder="Vendor (e.g. Palo Alto)"
                value={newVendor()}
                onInput={(e) => setNewVendor(e.currentTarget.value)}
                autofocus
              />
              <input
                class={`${formInputClass} mb-2`}
                placeholder="Product (e.g. PA-3220, Falcon, Enterprise Security)"
                value={newProduct()}
                onInput={(e) => setNewProduct(e.currentTarget.value)}
              />
              <Show when={createError()}>
                <div class="text-[11px] text-scarlet-400 mb-2 font-semibold">{createError()}</div>
              </Show>
              <div class="flex gap-3 justify-end">
                <button type="button" class={modalBtn.secondary} onClick={cancelCreate} disabled={creating()}>Cancel</button>
                <button type="button" class={modalBtn.primary} onClick={submitCreate} disabled={creating()}>
                  {creating() ? 'Creating...' : 'Create'}
                </button>
              </div>
            </div>
          }>
            <div class="p-2 border-b-2 border-base-600">
              <input
                class={formInputClass}
                placeholder={`Search ${props.category}...`}
                value={query()}
                onInput={(e) => setQuery(e.currentTarget.value)}
                autofocus
              />
            </div>
            <div class="flex-1 overflow-y-auto">
              <Show when={!options.loading} fallback={<div class="text-base-300 p-3 text-center text-sm">Loading...</div>}>
                <For each={filtered()}>
                  {(p: VendorProduct) => {
                    const isSel = () => selectedIds().has(p.id);
                    return (
                      <button
                        type="button"
                        class={`press-row w-full text-left border-b border-base-700 last:border-b-0 ${isSel() ? 'bg-base-700' : ''}`}
                        onClick={() => toggle(p)}
                      >
                        <span class="w-4 shrink-0 text-surf-300 font-bold">{isSel() ? '✓' : ''}</span>
                        <span class="flex-1 text-base-50 text-sm font-semibold">
                          {p.vendor_name} <span class="text-base-300 font-normal">{p.name}</span>
                        </span>
                        <Show when={p.needs_review}>
                          <span class="text-amber-300 text-[10px] uppercase tracking-wider">review</span>
                        </Show>
                      </button>
                    );
                  }}
                </For>
                <Show when={filtered().length === 0}>
                  <div class="text-base-300 p-3 text-center text-[13px]">
                    No {props.category} products match{query() ? ` "${query()}"` : ''}
                  </div>
                </Show>
              </Show>
            </div>
            <div class="flex border-t-2 border-base-600">
              <button
                type="button"
                class="flex-1 text-left px-3 py-2 text-[12px] font-bold uppercase tracking-wider text-surf-300 bg-base-800 transition-colors duration-150 hover:bg-base-700 cursor-pointer"
                onClick={startCreate}
              >
                + Create {query() ? `"${query()}"` : `new ${props.category}`}
              </button>
              <button
                type="button"
                class="px-3 py-2 text-[12px] font-bold uppercase tracking-wider text-base-300 bg-base-800 transition-colors duration-150 hover:bg-base-700 cursor-pointer"
                onClick={() => setOpen(false)}
              >
                Done
              </button>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
