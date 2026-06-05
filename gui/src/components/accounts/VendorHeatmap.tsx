import { createResource, For, Show } from 'solid-js';
import { api } from '../../lib/api';
import type { VendorHeatmapBucket, VendorHeatmapCellProduct } from '../../lib/types';
import { vendorProductLabel, vendorIsRedundant } from '../../lib/vendorProduct';

// Vendor slugs to highlight on the grid. PANW is the primary one — the whole
// point is "where is Palo Alto in this customer's stack?" — but the same lane
// can be reused for any vendor the user is benchmarking against.
const HIGHLIGHTED_VENDOR_SLUGS = new Set(['palo-alto-networks']);

function isHighlighted(slug: string): boolean {
  return HIGHLIGHTED_VENDOR_SLUGS.has(slug);
}

// Chip colors are driven entirely by theme ramps so they restyle with the
// active theme. Each background is paired with text from the SAME ramp: the
// accent ramps always run light(50)→dark(950) and the `base` ramp always runs
// text-end(50)→bg-end(950), so a `*-900` fill with `*-50` text stays
// high-contrast and readable in every theme — light or dark. Highlighted
// vendors (e.g. PANW) use the primary `surf` ramp so they pop; everything else
// uses the neutral `base` ramp to stay calm and easy on the eyes.
function ProductChip(props: { product: VendorHeatmapCellProduct }) {
  const highlighted = () => isHighlighted(props.product.vendor_slug);
  return (
    <div
      class={`px-2 py-1.5 border-2 leading-tight ${
        highlighted()
          ? 'bg-surf-900 border-surf-500 text-surf-50'
          : 'bg-base-950 border-base-600 text-base-50'
      }`}
      title={vendorProductLabel(props.product)}
    >
      <Show when={!vendorIsRedundant(props.product)}>
        <div class={`text-[9px] uppercase tracking-wider font-bold ${
          highlighted() ? 'text-surf-200' : 'text-base-300'
        }`}>
          {props.product.vendor_name}
        </div>
      </Show>
      <div class="text-[11px] font-semibold mt-0.5">{props.product.name}</div>
    </div>
  );
}

function BucketSection(props: { bucket: VendorHeatmapBucket }) {
  const subs = () => props.bucket.subcategories;
  const colCount = () => subs().length;
  const totalProducts = () => subs().reduce((sum, s) => sum + s.products.length, 0);

  return (
    <div class="border-2 border-surf-500/60">
      {/* Section banner */}
      <div class="bg-surf-500/30 px-3 py-2 border-b-2 border-surf-500/60 flex justify-between items-baseline">
        <h4 class="text-[13px] font-bold uppercase tracking-widest text-surf-100 font-[family-name:var(--font-display)]">
          {props.bucket.label}
        </h4>
        <span class="text-[10px] uppercase tracking-widest text-surf-300">
          {totalProducts()} {totalProducts() === 1 ? 'product' : 'products'}
        </span>
      </div>

      {/* Grid: one column per subcategory, single content row */}
      <div class="overflow-x-auto">
        <div
          class="grid min-w-max"
          style={{ 'grid-template-columns': `repeat(${colCount()}, minmax(140px, 1fr))` }}
        >
          {/* Header row — subcategory labels */}
          <For each={subs()}>
            {(sub, i) => (
              <div
                class={`px-2 py-2 bg-surf-500/15 ${i() > 0 ? 'border-l border-surf-500/40' : ''}`}
              >
                <div class="text-[10px] uppercase tracking-widest font-bold text-surf-200">
                  {sub.label}
                </div>
              </div>
            )}
          </For>

          {/* Content row — products in each subcategory */}
          <For each={subs()}>
            {(sub, i) => (
              <div
                class={`p-2 ${i() > 0 ? 'border-l border-base-700' : ''} border-t-2 border-surf-500/40`}
              >
                <Show
                  when={sub.products.length > 0}
                  fallback={
                    <div class="text-[11px] text-base-500 italic py-2 px-1 border-2 border-dashed border-base-600 text-center">
                      No solution
                    </div>
                  }
                >
                  <div class="flex flex-col gap-1.5">
                    <For each={sub.products}>
                      {(p) => <ProductChip product={p} />}
                    </For>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

export default function VendorHeatmap(props: { accountId: number }) {
  const [data] = createResource(() => props.accountId, (id) => api.getVendorHeatmap(id));

  return (
    <Show
      when={data()}
      fallback={<div class="text-base-300 p-10 text-center">Loading vendor heatmap...</div>}
    >
      {(snap) => (
        <div>
          <div class="flex flex-col gap-2 md:flex-row md:items-end md:justify-between mb-4">
            <p class="text-[11px] text-base-400">
              Each section is a portfolio bucket; columns are the fine-grained categories under it.
              Cells show the vendor product the account runs — Palo Alto Networks is highlighted.
            </p>
            <div class="flex items-center gap-3 text-[10px] uppercase tracking-widest text-base-400">
              <span class="flex items-center gap-1">
                <span class="inline-block w-3 h-3 bg-surf-900 border border-surf-500" />
                PANW
              </span>
              <span class="flex items-center gap-1">
                <span class="inline-block w-3 h-3 bg-base-950 border border-base-600" />
                Other vendor
              </span>
            </div>
          </div>

          <div class="flex flex-col gap-4">
            <For each={snap().buckets}>
              {(bucket) => <BucketSection bucket={bucket} />}
            </For>
          </div>
        </div>
      )}
    </Show>
  );
}
