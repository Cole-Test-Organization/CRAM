import { createResource, createSignal, createMemo, For, Show } from 'solid-js';
import { api } from '../lib/api';
import {
  ProductFormModal,
  ProductCategoryFormModal,
  VendorFormModal,
  VendorProductFormModal,
} from '../components/FormModals';
import Button from '../components/Button';
import { vendorProductLabel } from '../lib/vendorProduct';
import { apiFetch } from '../lib/offline';

const VENDOR_PRODUCT_CATEGORIES = [
  'firewall', 'edr', 'siem', 'idp', 'mfa', 'pam',
  'email_security', 'mdr', 'msp', 'sase', 'sdwan',
  'vpn', 'dlp', 'casb', 'vuln_mgmt', 'ticketing',
  'productivity_suite', 'cloud_provider',
  'cspm', 'appsec', 'ndr', 'iot_ot',
];

type Tab = 'sales' | 'vendors' | 'vendor_products';

const tabClass = (active: boolean) =>
  `px-4 py-2 text-[11px] cursor-pointer border-b-2 transition-colors duration-150 uppercase tracking-widest font-bold ${
    active ? 'text-surf-300 border-b-surf-400' : 'text-base-300 border-transparent hover:text-base-50'
  }`;

export default function Products() {
  const [tab, setTab] = createSignal<Tab>('sales');

  return (
    <div>
      <div class="flex flex-col gap-3 mb-6 md:flex-row md:justify-between md:items-start">
        <div>
          <h1 class="text-[26px] font-bold font-[family-name:var(--font-display)]">Catalogs</h1>
          <div class="text-base-400 text-[12px] mt-1 max-w-2xl">
            Sales Catalog is what <em>you sell</em> (used by opportunities). Vendors + Vendor Products are what
            <em> your accounts run</em> (used by account technical profiles). The two never link.
          </div>
        </div>
      </div>

      <div class="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 mb-5">
        <div class="flex gap-1 border-b-2 border-base-600 min-w-max md:min-w-0">
          <div class={tabClass(tab() === 'sales')} onClick={() => setTab('sales')}>Sales Catalog</div>
          <div class={tabClass(tab() === 'vendors')} onClick={() => setTab('vendors')}>Vendors</div>
          <div class={tabClass(tab() === 'vendor_products')} onClick={() => setTab('vendor_products')}>Vendor Products</div>
        </div>
      </div>

      <Show when={tab() === 'sales'}><SalesCatalogTab /></Show>
      <Show when={tab() === 'vendors'}><VendorsTab /></Show>
      <Show when={tab() === 'vendor_products'}><VendorProductsTab /></Show>
    </div>
  );
}

/* ─────────────────────── Sales Catalog tab ─────────────────────── */

function SalesCatalogTab() {
  const [productModal, setProductModal] = createSignal<{ open: boolean; existing?: any }>({ open: false });
  const [categoryModal, setCategoryModal] = createSignal<{ open: boolean; existing?: any }>({ open: false });

  const [products, { refetch: refetchProducts }] = createResource(() => api.getProducts({ limit: 500 }));
  const [categories, { refetch: refetchCategories }] = createResource(() => api.getProductCategories({ limit: 500 }));

  const refreshAll = () => { refetchProducts(); refetchCategories(); };

  const deleteProduct = async (p: any) => {
    if (!confirm(`Delete product "${p.name}"? It will be removed from any opportunities that reference it.`)) return;
    await api.deleteProduct(p.id);
    refetchProducts();
  };

  const deleteCategory = async (c: any) => {
    const msg = c.product_count
      ? `Delete category "${c.name}"? ${c.product_count} product(s) in it will keep existing but lose their category.`
      : `Delete category "${c.name}"?`;
    if (!confirm(msg)) return;
    await api.deleteProductCategory(c.id);
    refreshAll();
  };

  return (
    <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
      <div class="md:col-span-2">
        <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 class="text-[14px] uppercase tracking-widest font-bold text-surf-300">
            Products ({products()?.products?.length || 0})
          </h2>
          <Button variant="primary" size="sm" onClick={() => setProductModal({ open: true })}>+ New Product</Button>
        </div>
        <div class="panel panel-accent">
          <Show when={!products.loading} fallback={<div class="text-base-300 p-10 text-center">Loading...</div>}>
            <For each={products()?.products || []} fallback={
              <div class="text-base-400 text-center p-8 text-sm italic">
                No products yet. <button class="text-surf-300 underline" onClick={() => setProductModal({ open: true })}>Create one</button>.
              </div>
            }>
              {(p: any) => (
                <div class="press-row gap-3 flex-wrap border-b border-base-700 last:border-b-0">
                  <span class="flex-1 min-w-[60%] md:min-w-[200px] font-semibold text-sm text-base-50">{p.name}</span>
                  <Show when={p.category_name} fallback={<span class="text-base-500 text-[11px] uppercase tracking-wider italic">uncategorized</span>}>
                    <span class="text-base-300 text-[11px] uppercase tracking-wider">{p.category_name}</span>
                  </Show>
                  <div class="flex items-center gap-2">
                    <button type="button" class="press press-ghost press-sm" onClick={() => setProductModal({ open: true, existing: p })}>Edit</button>
                    <button type="button" class="btn-x" aria-label={`Delete ${p.name}`} onClick={() => deleteProduct(p)}>&times;</button>
                  </div>
                </div>
              )}
            </For>
          </Show>
        </div>
      </div>

      <div>
        <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 class="text-[14px] uppercase tracking-widest font-bold text-surf-300">
            Categories ({categories()?.categories?.length || 0})
          </h2>
          <Button variant="primary" size="sm" onClick={() => setCategoryModal({ open: true })}>+ New</Button>
        </div>
        <div class="panel panel-accent">
          <Show when={!categories.loading} fallback={<div class="text-base-300 p-10 text-center">Loading...</div>}>
            <For each={categories()?.categories || []} fallback={
              <div class="text-base-400 text-center p-8 text-sm italic">
                No categories. <button class="text-surf-300 underline" onClick={() => setCategoryModal({ open: true })}>Create one</button>.
              </div>
            }>
              {(c: any) => (
                <div class="press-row gap-3 flex-wrap border-b border-base-700 last:border-b-0">
                  <span class="flex-1 min-w-[60%] font-semibold text-sm text-base-50">{c.name}</span>
                  <span class="text-base-400 text-[11px] uppercase tracking-wider">{c.product_count || 0} item{(c.product_count || 0) === 1 ? '' : 's'}</span>
                  <div class="flex items-center gap-2">
                    <button type="button" class="press press-ghost press-sm" onClick={() => setCategoryModal({ open: true, existing: c })}>Edit</button>
                    <button type="button" class="btn-x" aria-label={`Delete ${c.name}`} onClick={() => deleteCategory(c)}>&times;</button>
                  </div>
                </div>
              )}
            </For>
          </Show>
        </div>
      </div>

      <ProductFormModal
        open={productModal().open}
        existing={productModal().existing}
        onClose={() => setProductModal({ open: false })}
        onSaved={() => refreshAll()}
      />
      <ProductCategoryFormModal
        open={categoryModal().open}
        existing={categoryModal().existing}
        onClose={() => setCategoryModal({ open: false })}
        onSaved={() => refreshAll()}
      />
    </div>
  );
}

/* ─────────────────────── Vendors tab ─────────────────────── */

function VendorsTab() {
  const [vendorModal, setVendorModal] = createSignal<{ open: boolean; existing?: any }>({ open: false });
  const [search, setSearch] = createSignal('');
  const [needsReviewOnly, setNeedsReviewOnly] = createSignal(false);
  const [includeDeleted, setIncludeDeleted] = createSignal(false);

  const [vendors, { refetch }] = createResource(() => api.getVendors({
    include_deleted: true,
  }));
  const visibleVendors = createMemo(() => {
    const query = search().trim().toLowerCase();
    return (vendors()?.vendors || []).filter((vendor: any) => {
      if (!includeDeleted() && vendor.deleted_at) return false;
      if (needsReviewOnly() && !vendor.needs_review) return false;
      if (!query) return true;
      return [vendor.name, vendor.slug, vendor.website]
        .some((value) => String(value || '').toLowerCase().includes(query));
    });
  });

  const softDelete = async (v: any) => {
    if (!confirm(`Soft-delete "${v.name}"? Existing account_details references are preserved.`)) return;
    await api.deleteVendor(v.id);
    refetch();
  };

  const restore = async (v: any) => {
    // Restore via PATCH — clear deleted_at would require the dedicated endpoint, but
    // the GUI is fine going through the PATCH endpoint since the service also clears
    // it. Actually we should use the dedicated restore route — call it via fetch.
    await apiFetch(`/api/vendors/${v.id}/restore`, { method: 'POST' });
    refetch();
  };

  return (
    <>
      <div class="flex flex-col gap-3 mb-4 md:flex-row md:items-center md:justify-between">
        <div class="flex items-center gap-3 flex-wrap flex-1">
          <input
            type="text"
            class="input-vintage flex-1 min-w-[200px]"
            placeholder="Search vendors..."
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
          />
          <label class="flex items-center gap-2 cursor-pointer text-[11px] uppercase tracking-wider font-semibold">
            <input type="checkbox" class="accent-surf-400 w-4 h-4 cursor-pointer" checked={needsReviewOnly()} onChange={(e) => setNeedsReviewOnly(e.currentTarget.checked)} />
            Needs review
          </label>
          <label class="flex items-center gap-2 cursor-pointer text-[11px] uppercase tracking-wider font-semibold">
            <input type="checkbox" class="accent-surf-400 w-4 h-4 cursor-pointer" checked={includeDeleted()} onChange={(e) => setIncludeDeleted(e.currentTarget.checked)} />
            Show deleted
          </label>
        </div>
        <Button variant="primary" size="sm" onClick={() => setVendorModal({ open: true })}>+ New Vendor</Button>
      </div>

      <div class="panel panel-accent">
        <Show when={!vendors.loading} fallback={<div class="text-base-300 p-10 text-center">Loading...</div>}>
          <For each={visibleVendors()} fallback={
            <div class="text-base-400 text-center p-8 text-sm italic">
              No vendors {search() ? `match "${search()}"` : 'yet'}. <button class="text-surf-300 underline" onClick={() => setVendorModal({ open: true })}>Create one</button>.
            </div>
          }>
            {(v: any) => (
              <div class={`press-row gap-3 flex-wrap border-b border-base-700 last:border-b-0 ${v.deleted_at ? 'opacity-60' : ''}`}>
                <span class="flex-1 min-w-[40%] md:min-w-[160px] font-semibold text-sm text-base-50">{v.name}</span>
                <span class="text-base-400 text-[11px] uppercase tracking-wider font-mono">{v.slug}</span>
                <Show when={v.website}>
                  <a href={v.website!} target="_blank" rel="noopener" class="text-surf-300 text-[11px] uppercase tracking-wider hover:underline" onClick={(e) => e.stopPropagation()}>site</a>
                </Show>
                <Show when={v.needs_review}>
                  <span class="text-amber-300 text-[10px] uppercase tracking-wider font-bold">review</span>
                </Show>
                <Show when={v.deleted_at}>
                  <span class="text-scarlet-300 text-[10px] uppercase tracking-wider font-bold">deleted</span>
                </Show>
                <div class="flex items-center gap-2">
                  <button type="button" class="press press-ghost press-sm" onClick={() => setVendorModal({ open: true, existing: v })}>Edit</button>
                  <Show when={!v.deleted_at} fallback={
                    <button type="button" class="press press-ghost press-sm" onClick={() => restore(v)}>Restore</button>
                  }>
                    <button type="button" class="btn-x" aria-label={`Delete ${v.name}`} onClick={() => softDelete(v)}>&times;</button>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </Show>
      </div>

      <VendorFormModal
        open={vendorModal().open}
        existing={vendorModal().existing}
        onClose={() => setVendorModal({ open: false })}
        onSaved={() => refetch()}
      />
    </>
  );
}

/* ─────────────────────── Vendor Products tab ─────────────────────── */

function VendorProductsTab() {
  const [productModal, setProductModal] = createSignal<{ open: boolean; existing?: any; lockedCategory?: string }>({ open: false });
  const [search, setSearch] = createSignal('');
  const [category, setCategory] = createSignal('');
  const [needsReviewOnly, setNeedsReviewOnly] = createSignal(false);
  const [includeDeleted, setIncludeDeleted] = createSignal(false);

  const [products, { refetch }] = createResource(() => api.getVendorProducts({
    include_deleted: true,
  }));

  const visibleProducts = createMemo(() => {
    const query = search().trim().toLowerCase();
    return (products()?.products || []).filter((product: any) => {
      if (!includeDeleted() && product.deleted_at) return false;
      if (needsReviewOnly() && !product.needs_review) return false;
      if (category() && product.category !== category()) return false;
      if (!query) return true;
      return [product.name, product.slug, product.vendor_name, product.vendor_slug]
        .some((value) => String(value || '').toLowerCase().includes(query));
    });
  });

  const grouped = createMemo(() => {
    const list = visibleProducts();
    const byCategory = new Map<string, any[]>();
    for (const p of list) {
      const arr = byCategory.get(p.category) || [];
      arr.push(p);
      byCategory.set(p.category, arr);
    }
    return [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  });

  const softDelete = async (p: any) => {
    if (!confirm(`Soft-delete "${vendorProductLabel(p)}"? Existing account_details references are preserved.`)) return;
    await api.deleteVendorProduct(p.id);
    refetch();
  };

  const restore = async (p: any) => {
    await apiFetch(`/api/vendor-products/${p.id}/restore`, { method: 'POST' });
    refetch();
  };

  // ── Merge (de-dupe) ──────────────────────────────────────────────────
  // Select up to two live rows, choose which survives (Git-style), and merge:
  // the loser's account references repoint to the winner, loser is soft-deleted.
  const [selected, setSelected] = createSignal<any[]>([]);
  const [winnerId, setWinnerId] = createSignal<number | null>(null);
  const [merging, setMerging] = createSignal(false);

  const isSelected = (p: any) => selected().some((x) => x.id === p.id);
  const toggleSelect = (p: any) => {
    if (isSelected(p)) {
      const next = selected().filter((x) => x.id !== p.id);
      setSelected(next);
      if (winnerId() === p.id) setWinnerId(next[0]?.id ?? null);
    } else if (selected().length < 2) {
      const next = [...selected(), p];
      setSelected(next);
      if (next.length === 1) setWinnerId(p.id);
    }
  };
  const clearSelection = () => { setSelected([]); setWinnerId(null); };
  const sameCategory = () => selected().length === 2 && selected()[0].category === selected()[1].category;

  const doMerge = async () => {
    const winner = selected().find((p) => p.id === winnerId());
    const loser = selected().find((p) => p.id !== winnerId());
    if (!winner || !loser) return;
    if (!confirm(
      `Merge "${vendorProductLabel(loser)}" into "${vendorProductLabel(winner)}"?\n\n` +
      `Every account that runs "${vendorProductLabel(loser)}" will be repointed to ` +
      `"${vendorProductLabel(winner)}", and the duplicate will be retired (soft-deleted, restorable).`
    )) return;
    setMerging(true);
    try {
      const res = await api.mergeVendorProducts(winner.id, loser.id);
      clearSelection();
      refetch();
      alert(`Merged. ${res.accounts_repointed} account row(s) now point to "${vendorProductLabel(winner)}".`);
    } catch (e: any) {
      alert(e?.message || 'Merge failed');
    } finally {
      setMerging(false);
    }
  };

  return (
    <>
      <div class="flex flex-col gap-3 mb-4 md:flex-row md:items-center md:justify-between">
        <div class="flex items-center gap-3 flex-wrap flex-1">
          <input
            type="text"
            class="input-vintage flex-1 min-w-[200px]"
            placeholder="Search products or vendors..."
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
          />
          <select
            class="input-vintage cursor-pointer"
            style="width: auto; min-width: 160px;"
            value={category()}
            onChange={(e) => setCategory(e.currentTarget.value)}
          >
            <option value="">All categories</option>
            <For each={VENDOR_PRODUCT_CATEGORIES}>
              {(c) => <option value={c}>{c}</option>}
            </For>
          </select>
          <label class="flex items-center gap-2 cursor-pointer text-[11px] uppercase tracking-wider font-semibold">
            <input type="checkbox" class="accent-surf-400 w-4 h-4 cursor-pointer" checked={needsReviewOnly()} onChange={(e) => setNeedsReviewOnly(e.currentTarget.checked)} />
            Needs review
          </label>
          <label class="flex items-center gap-2 cursor-pointer text-[11px] uppercase tracking-wider font-semibold">
            <input type="checkbox" class="accent-surf-400 w-4 h-4 cursor-pointer" checked={includeDeleted()} onChange={(e) => setIncludeDeleted(e.currentTarget.checked)} />
            Show deleted
          </label>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={() => setProductModal({ open: true, lockedCategory: category() || undefined })}
        >
          + New Product
        </Button>
      </div>

      <Show when={selected().length > 0}>
        <div class="panel panel-accent p-3 mb-4 border-2 border-surf-500 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div class="flex items-center gap-2 flex-wrap text-[12px]">
            <span class="uppercase tracking-widest font-bold text-surf-300">Merge {selected().length}/2</span>
            <For each={selected()}>
              {(p) => (
                <span class="font-semibold text-base-50">{vendorProductLabel(p)} <span class="text-base-400 font-normal">[{p.category}]</span></span>
              )}
            </For>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <Show when={selected().length === 2} fallback={
              <span class="text-base-400 text-[11px] uppercase tracking-wider">pick one more</span>
            }>
              <Show when={sameCategory()} fallback={
                <span class="text-scarlet-400 text-[11px] uppercase tracking-wider font-bold">same category only</span>
              }>
                <span class="text-[11px] uppercase tracking-wider text-base-300">keep:</span>
                <For each={selected()}>
                  {(p) => (
                    <button
                      type="button"
                      class={`px-2 py-1 text-[11px] font-bold uppercase tracking-wider border-2 transition-colors duration-150 ${
                        winnerId() === p.id ? 'bg-surf-500/20 text-surf-200 border-surf-500' : 'text-base-300 border-base-600 hover:text-base-50'
                      }`}
                      onClick={() => setWinnerId(p.id)}
                    >{vendorProductLabel(p)}</button>
                  )}
                </For>
                <button
                  type="button"
                  class="px-3 py-1 text-[11px] font-bold uppercase tracking-wider border-2 border-surf-500 bg-surf-500/20 text-surf-100 hover:bg-surf-500/30 disabled:opacity-50"
                  disabled={merging()}
                  onClick={doMerge}
                >{merging() ? 'Merging…' : 'Merge →'}</button>
              </Show>
            </Show>
            <button
              type="button"
              class="px-3 py-1 text-[11px] font-bold uppercase tracking-wider border-2 border-base-600 text-base-300 hover:text-base-50"
              onClick={clearSelection}
            >Cancel</button>
          </div>
        </div>
      </Show>

      <Show when={!products.loading} fallback={<div class="text-base-300 p-10 text-center">Loading...</div>}>
        <For each={grouped()} fallback={
          <div class="panel panel-accent">
            <div class="text-base-400 text-center p-8 text-sm italic">
              No vendor products {search() || category() ? 'match the filters' : 'yet'}.{' '}
              <button class="text-surf-300 underline" onClick={() => setProductModal({ open: true, lockedCategory: category() || undefined })}>Create one</button>.
            </div>
          </div>
        }>
          {([cat, items]) => (
            <div class="mb-5">
              <div class="flex items-center justify-between mb-2">
                <h2 class="text-[13px] uppercase tracking-widest font-bold text-surf-300">
                  {cat} <span class="text-base-400 font-normal">({items.length})</span>
                </h2>
                <button
                  type="button"
                  class="press press-ghost press-sm"
                  onClick={() => setProductModal({ open: true, lockedCategory: cat })}
                >
                  + Add {cat}
                </button>
              </div>
              <div class="panel panel-accent">
                <For each={items}>
                  {(p: any) => (
                    <div class={`press-row gap-3 flex-wrap border-b border-base-700 last:border-b-0 ${p.deleted_at ? 'opacity-60' : ''}`}>
                      <Show when={!p.deleted_at} fallback={<span class="w-4 shrink-0" />}>
                        <input
                          type="checkbox"
                          class="accent-surf-400 w-4 h-4 cursor-pointer shrink-0"
                          title="Select to merge"
                          checked={isSelected(p)}
                          disabled={!isSelected(p) && selected().length >= 2}
                          onChange={() => toggleSelect(p)}
                        />
                      </Show>
                      <span class="text-base-300 text-[12px] min-w-[100px] font-semibold">{p.vendor_name}</span>
                      <span class="flex-1 min-w-[40%] md:min-w-[180px] text-base-50 text-sm font-semibold">{p.name}</span>
                      <span class="text-base-400 text-[10px] uppercase tracking-wider font-mono">{p.slug}</span>
                      <Show when={p.needs_review}>
                        <span class="text-amber-300 text-[10px] uppercase tracking-wider font-bold">review</span>
                      </Show>
                      <Show when={p.deleted_at}>
                        <span class="text-scarlet-300 text-[10px] uppercase tracking-wider font-bold">deleted</span>
                      </Show>
                      <div class="flex items-center gap-2">
                        <button type="button" class="press press-ghost press-sm" onClick={() => setProductModal({ open: true, existing: p })}>Edit</button>
                        <Show when={!p.deleted_at} fallback={
                          <button type="button" class="press press-ghost press-sm" onClick={() => restore(p)}>Restore</button>
                        }>
                          <button type="button" class="btn-x" aria-label={`Delete ${vendorProductLabel(p)}`} onClick={() => softDelete(p)}>&times;</button>
                        </Show>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
      </Show>

      <VendorProductFormModal
        open={productModal().open}
        existing={productModal().existing}
        lockedCategory={productModal().lockedCategory}
        onClose={() => setProductModal({ open: false })}
        onSaved={() => refetch()}
      />
    </>
  );
}
