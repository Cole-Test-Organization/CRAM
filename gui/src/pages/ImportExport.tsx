import { createResource, createSignal, For, Show } from 'solid-js';
import { api } from '../lib/api';
import Button from '../components/Button';
import NotesImportPanel from '../components/NotesImportPanel';
import { downloadBlob } from '../lib/textExport';
import { formatDateTime, todayLocalDate } from '../utils/date';

type ImportResult = {
  imported_at: string;
  account_count: number;
  results: Array<{
    slug: string | null;
    ok: boolean;
    error?: string;
    account_id?: number;
    created?: { accounts: number; contacts: number; meetings: number; opportunities: number; partners: number; products: number };
    updated?: { account: boolean; details: boolean; contacts: number; meetings: number; opportunities: number };
  }>;
};

export default function ImportExport() {
  const [accountsData] = createResource(() => api.getAccounts({ sort: 'name' }));
  const [selected, setSelected] = createSignal<Set<string>>(new Set());
  const [filter, setFilter] = createSignal('');
  const [exporting, setExporting] = createSignal<'drive' | 'json' | null>(null);
  const [importing, setImporting] = createSignal(false);
  const [importResult, setImportResult] = createSignal<ImportResult | null>(null);
  const [importError, setImportError] = createSignal('');

  const filtered = () => {
    const q = filter().toLowerCase();
    const accounts = accountsData()?.accounts || [];
    if (!q) return accounts;
    return accounts.filter((a: any) => a.name.toLowerCase().includes(q) || a.slug.includes(q));
  };

  const toggle = (slug: string) => {
    const next = new Set(selected());
    if (next.has(slug)) next.delete(slug); else next.add(slug);
    setSelected(next);
  };

  const selectAll = () => setSelected(new Set(filtered().map((a: any) => a.slug)));
  const clearAll = () => setSelected(new Set<string>());

  const doJsonExport = async () => {
    const slugs = [...selected()];
    if (slugs.length === 0) return;
    setExporting('json');
    try {
      const bundle = await api.exportBundle(slugs);
      const date = todayLocalDate();
      const name = slugs.length === 1 ? `${slugs[0]}.json` : `accounts-export-${date}.json`;
      downloadBlob(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }), name);
    } catch (err: any) {
      alert(`Export failed: ${err.message || err}`);
    } finally {
      setExporting(null);
    }
  };

  const doDriveExport = async () => {
    const slugs = [...selected()];
    if (slugs.length === 0) return;
    setExporting('drive');
    try {
      const archive = await api.exportDriveBundle(slugs);
      downloadBlob(archive.blob, archive.filename);
    } catch (err: any) {
      alert(`Export failed: ${err.message || err}`);
    } finally {
      setExporting(null);
    }
  };

  const onFileChosen = async (file: File) => {
    setImportError('');
    setImportResult(null);
    setImporting(true);
    try {
      const text = await file.text();
      const bundle = JSON.parse(text);
      const result = await api.importBundle(bundle);
      setImportResult(result);
    } catch (err: any) {
      setImportError(err?.message || String(err));
    } finally {
      setImporting(false);
    }
  };

  let fileInputRef: HTMLInputElement | undefined;

  return (
    <div>
      <div class="flex flex-col gap-3 mb-6 md:flex-row md:justify-between md:items-center">
        <h1 class="text-[26px] font-bold font-[family-name:var(--font-display)]">Import / Export</h1>
      </div>

      {/* === NOTES === */}
      <section class="mb-10">
        <h2 class="text-[18px] font-bold uppercase tracking-widest text-surf-300 mb-4 pb-2 border-b-2 border-base-600 font-[family-name:var(--font-display)]">Notes</h2>
        <NotesImportPanel />
      </section>

      {/* === ACCOUNT BUNDLES === */}
      <section>
      <h2 class="text-[18px] font-bold uppercase tracking-widest text-surf-300 mb-4 pb-2 border-b-2 border-base-600 font-[family-name:var(--font-display)]">Account bundles</h2>

      <p class="text-base-300 text-[13px] mb-6">
        Select any set of accounts once, then export a Google Drive folder bundle for human-readable handoff or a
        portable JSON bundle for moving data between tenants. Drive bundles contain an overview, contacts, and one
        editable Word document per meeting for each account. JSON bundles also carry technical profiles,
        opportunities, and linked partner shells and can be imported below.
      </p>

      <div class="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* === EXPORT === */}
        <div class="panel panel-accent p-5">
          <h3 class="text-[15px] font-bold uppercase tracking-widest text-surf-300 mb-4 font-[family-name:var(--font-display)]">Export</h3>

          <div class="flex items-center bg-base-950 border-2 border-base-500 px-3 py-2 gap-2 mb-3 focus-within:border-surf-300 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-surf-400"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input
              type="text"
              placeholder="Filter accounts..."
              value={filter()}
              onInput={(e) => setFilter(e.currentTarget.value)}
              class="flex-1 bg-transparent border-none outline-none text-base-50 text-sm placeholder:text-base-400"
            />
          </div>

          <div class="flex flex-wrap items-center gap-3 mb-3">
            <span class="text-base-300 text-[11px] uppercase tracking-wider">
              {selected().size} of {filtered().length} selected
            </span>
            <button class="text-surf-300 text-[11px] uppercase tracking-wider hover:text-surf-200" onClick={selectAll}>Select all</button>
            <button class="text-base-300 text-[11px] uppercase tracking-wider hover:text-base-50" onClick={clearAll}>Clear</button>
          </div>

          <div class="border-2 border-base-600 bg-base-950 max-h-96 overflow-y-auto mb-4">
            <Show when={!accountsData.loading} fallback={<div class="text-base-300 p-6 text-center">Loading...</div>}>
              <For each={filtered()} fallback={<div class="text-base-300 text-center p-6 text-sm">No accounts</div>}>
                {(acct: any) => (
                  <label class="flex items-center gap-3 px-3 py-2 border-b border-base-700 last:border-b-0 cursor-pointer hover:bg-base-700/30">
                    <input
                      type="checkbox"
                      checked={selected().has(acct.slug)}
                      onChange={() => toggle(acct.slug)}
                      class="accent-surf-400"
                    />
                    <span class="flex-1 text-sm text-base-50">{acct.name}</span>
                    <span class="text-base-400 text-[11px]">{acct.status || 'account'}</span>
                  </label>
                )}
              </For>
            </Show>
          </div>

          <div class="flex flex-col gap-3 md:flex-row md:flex-wrap">
            <Button
              variant="primary"
              class="w-full md:w-auto"
              disabled={selected().size === 0 || Boolean(exporting())}
              onClick={doDriveExport}
            >
              {exporting() === 'drive' ? 'Building Drive bundle...' : `Export ${selected().size || ''} for Drive`}
            </Button>
            <Button
              variant="secondary"
              class="w-full md:w-auto"
              disabled={selected().size === 0 || Boolean(exporting())}
              onClick={doJsonExport}
            >
              {exporting() === 'json' ? 'Building JSON bundle...' : `Export ${selected().size || ''} as JSON`}
            </Button>
          </div>
        </div>

        {/* === IMPORT === */}
        <div class="panel panel-accent p-5">
          <h3 class="text-[15px] font-bold uppercase tracking-widest text-surf-300 mb-4 font-[family-name:var(--font-display)]">Import</h3>

          <p class="text-base-300 text-[12px] mb-4">
            Pick a bundle JSON file exported from this app. Accounts are matched by slug; contacts by email;
            meetings by filename; opportunities by name. Missing rows are created, existing rows updated.
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            class="hidden"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              if (file) onFileChosen(file);
              e.currentTarget.value = '';
            }}
          />

          <Button variant="primary" disabled={importing()} onClick={() => fileInputRef?.click()}>
            {importing() ? 'Importing...' : 'Choose JSON file...'}
          </Button>

          <Show when={importError()}>
            <div class="mt-4 p-3 border-2 border-scarlet-500/50 bg-scarlet-500/10 text-scarlet-300 text-[12px]">
              {importError()}
            </div>
          </Show>

          <Show when={importResult()}>
            {(result) => (
              <div class="mt-4">
                <div class="text-[11px] uppercase tracking-wider text-base-300 mb-2">
                  Imported at {formatDateTime(result().imported_at)} — {result().account_count} account(s)
                </div>
                <div class="border-2 border-base-600 bg-base-950 max-h-72 overflow-y-auto">
                  <For each={result().results}>
                    {(r) => (
                      <div class="px-3 py-2 border-b border-base-700 last:border-b-0">
                        <div class="flex items-center gap-2 flex-wrap">
                          <span class={`text-[10px] font-bold uppercase px-2 py-0.5 ${r.ok ? 'text-surf-300 bg-surf-500/10 border border-surf-500/50' : 'text-scarlet-300 bg-scarlet-500/10 border border-scarlet-500/50'}`}>
                            {r.ok ? 'OK' : 'ERROR'}
                          </span>
                          <span class="text-sm text-base-50">{r.slug || '(no slug)'}</span>
                        </div>
                        <Show when={r.ok && r.created}>
                          <div class="text-[11px] text-base-300 mt-1">
                            <Show when={r.created!.accounts}>+1 account </Show>
                            <Show when={r.created!.contacts}>+{r.created!.contacts} contacts </Show>
                            <Show when={r.created!.meetings}>+{r.created!.meetings} meetings </Show>
                            <Show when={r.created!.opportunities}>+{r.created!.opportunities} opps </Show>
                            <Show when={r.created!.partners}>+{r.created!.partners} partners </Show>
                            <Show when={r.created!.products}>+{r.created!.products} products </Show>
                            <Show when={r.updated && (r.updated.account || r.updated.contacts || r.updated.meetings || r.updated.opportunities)}>
                              · updated: {[
                                r.updated!.account && 'account',
                                r.updated!.details && 'details',
                                r.updated!.contacts && `${r.updated!.contacts} contacts`,
                                r.updated!.meetings && `${r.updated!.meetings} meetings`,
                                r.updated!.opportunities && `${r.updated!.opportunities} opps`,
                              ].filter(Boolean).join(', ')}
                            </Show>
                          </div>
                        </Show>
                        <Show when={!r.ok && r.error}>
                          <div class="text-[11px] text-scarlet-300 mt-1">{r.error}</div>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            )}
          </Show>
        </div>
      </div>
      </section>
    </div>
  );
}
