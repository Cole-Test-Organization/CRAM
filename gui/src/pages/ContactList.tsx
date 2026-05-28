import { createSignal, createResource, createEffect, For, Show } from 'solid-js';
import { A, useNavigate } from '@solidjs/router';
import { api } from '../lib/api';
import { ContactFormModal } from '../components/FormModals';
import Button from '../components/Button';
import ExportActions from '../components/ExportActions';
import { buildContactsExport } from '../lib/contactExport';

type Props = {
  // When set, scopes the list to this account's contacts (via the per-account
  // endpoint) and pins the New Contact modal. Standalone /contacts page mode
  // when unset: shows the H1, the company dropdown, and the linked-accounts
  // column, and navigates to the new contact after creation.
  accountId?: number;
  accountName?: string;
  onAfterCreate?: (contact: any) => void;
  onAfterDelete?: () => void;
};

export default function ContactList(props: Props = {}) {
  const [search, setSearch] = createSignal('');
  const [company, setCompany] = createSignal('');
  const [modalOpen, setModalOpen] = createSignal(false);
  const [selectedIds, setSelectedIds] = createSignal<Set<number>>(new Set<number>());
  const navigate = useNavigate();

  const isEmbedded = () => props.accountId !== undefined && props.accountId !== null;

  // Companies dropdown is only useful on the global page — skip the fetch when embedded.
  const [companies, { refetch: refetchCompanies }] = createResource(
    () => ({ embedded: isEmbedded() }),
    async ({ embedded }) => (embedded ? [] : api.getContactCompanies()),
  );

  // Per-account endpoint omits search filtering server-side, so we do it
  // client-side in embedded mode. Global mode keeps API-level filtering for
  // larger result sets.
  const [contacts, { refetch }] = createResource(
    () => ({ accountId: props.accountId, company: company(), search: search() }),
    async ({ accountId, company: companySlug, search: searchTerm }) => {
      if (accountId !== undefined && accountId !== null) return api.getContacts(accountId);
      return api.getAllContacts({
        company: companySlug || undefined,
        search: searchTerm || undefined,
      });
    },
  );

  // Drop any stale selection when the scope changes.
  createEffect(() => {
    void props.accountId;
    setSelectedIds(new Set<number>());
  });

  const matchesSearch = (c: any, q: string) =>
    (c.full_name || '').toLowerCase().includes(q) ||
    (c.email || '').toLowerCase().includes(q) ||
    (c.title || '').toLowerCase().includes(q) ||
    (c.company || '').toLowerCase().includes(q) ||
    (c.account_names || '').toLowerCase().includes(q);

  const filtered = () => {
    const list = contacts() || [];
    // In embedded mode the API didn't filter, so do it here.
    if (!isEmbedded()) return list;
    const q = search().toLowerCase();
    if (!q) return list;
    return list.filter((c: any) => matchesSearch(c, q));
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const visibleIds = () => filtered().map((c: any) => c.id as number);

  const allVisibleSelected = () => {
    const ids = visibleIds();
    if (ids.length === 0) return false;
    const sel = selectedIds();
    return ids.every((id) => sel.has(id));
  };

  const toggleSelectAllVisible = () => {
    const ids = visibleIds();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected()) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set<number>());
  const selectedCount = () => selectedIds().size;
  const selectedIdList = () => Array.from(selectedIds());

  const buildExport = (ids: number[]) => {
    const idSet = new Set(ids);
    const items = (contacts() || []).filter((c: any) => idSet.has(c.id));
    return buildContactsExport(items);
  };

  const deleteContact = async (id: number) => {
    if (!confirm('Delete this contact?')) return;
    await api.deleteContact(id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    refetch();
    refetchCompanies();
    props.onAfterDelete?.();
  };

  return (
    <div>
      <div class="flex flex-col gap-3 mb-6 md:flex-row md:items-center">
        <Show when={!isEmbedded()}>
          <h1 class="text-[26px] font-bold font-[family-name:var(--font-display)]">Contacts</h1>
        </Show>
        <div class="flex items-center gap-4 flex-wrap md:ml-auto">
          <span class="text-base-300 text-[12px] uppercase tracking-wider">
            {filtered().length} contact{filtered().length === 1 ? '' : 's'}
          </span>
          <Button variant="primary" size={isEmbedded() ? 'sm' : 'md'} onClick={() => setModalOpen(true)}>+ New Contact</Button>
        </div>
      </div>

      <div class="flex flex-col gap-3 mb-5 md:flex-row md:items-center md:flex-wrap">
        <div class="flex items-center bg-base-950 border-2 border-base-500 px-3 py-2 gap-2 w-full md:max-w-[400px] md:flex-1 focus-within:border-surf-300 transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-surf-400"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input
            type="text"
            placeholder="Search by name, email, title..."
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
            class="flex-1 bg-transparent border-none outline-none text-base-50 text-sm placeholder:text-base-400"
          />
        </div>

        <Show when={!isEmbedded()}>
          <select
            class="input-vintage cursor-pointer w-full md:max-w-[220px]"
            value={company()}
            onChange={(e) => setCompany(e.currentTarget.value)}
          >
            <option value="">All Companies</option>
            <For each={companies() || []}>
              {(c: any) => (
                <option value={c.slug}>{c.name} ({c.contact_count})</option>
              )}
            </For>
          </select>
        </Show>
      </div>

      <div class="flex flex-col gap-3 mb-3 md:flex-row md:items-center md:justify-between">
        <div class="flex items-center gap-3 flex-wrap">
          <label class="flex items-center gap-2 cursor-pointer text-[11px] uppercase tracking-wider font-semibold text-base-200">
            <input
              type="checkbox"
              class="accent-surf-400 w-4 h-4 cursor-pointer"
              checked={allVisibleSelected()}
              onChange={toggleSelectAllVisible}
            />
            Select all
          </label>
          <span class="text-base-300 text-[11px] uppercase tracking-wider">
            {selectedCount()} selected
          </span>
          <Show when={selectedCount() > 0}>
            <button
              class="text-base-300 text-[11px] uppercase tracking-wider hover:text-base-50"
              onClick={clearSelection}
            >
              Clear
            </button>
          </Show>
        </div>
        <ExportActions ids={selectedIdList} build={buildExport} disabled={() => contacts.loading} />
      </div>

      <Show when={!contacts.loading} fallback={<div class="text-base-300 p-10 text-center">Loading...</div>}>
        <div class="panel panel-accent">
          <For each={filtered()} fallback={<div class="text-base-300 text-center p-10 text-sm">No contacts found</div>}>
            {(c: any) => (
              <div class="flex items-center border-b border-base-700 last:border-b-0">
                <label class="flex items-center self-stretch pl-3 pr-1 cursor-pointer">
                  <input
                    type="checkbox"
                    class="accent-surf-400 w-4 h-4 cursor-pointer"
                    checked={selectedIds().has(c.id)}
                    onChange={() => toggleSelect(c.id)}
                  />
                </label>
                <A href={`/contacts/${c.id}`} class="press-row gap-4 flex-wrap flex-1 min-w-0">
                  <span class="flex-1 min-w-full md:min-w-0 font-semibold text-sm text-base-50">{c.full_name}</span>
                  <Show when={c.title}>
                    <span class="text-base-300 text-[12px]">{c.title}</span>
                  </Show>
                  <Show when={!isEmbedded() && c.account_names}>
                    <span class="text-base-300 text-[12px]">{c.account_names}</span>
                  </Show>
                  <Show when={c.email}>
                    <span class="text-base-300 text-[12px]">{c.email}</span>
                  </Show>
                </A>
                <button
                  class="btn-x mr-2 md:mr-3 shrink-0"
                  onClick={() => deleteContact(c.id)}
                  title="Delete contact"
                >
                  ×
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>

      <ContactFormModal
        open={modalOpen()}
        onClose={() => setModalOpen(false)}
        fixedAccountId={props.accountId}
        fixedAccountName={props.accountName}
        onSaved={(contact) => {
          refetch();
          refetchCompanies();
          if (props.onAfterCreate) {
            props.onAfterCreate(contact);
          } else {
            navigate(`/contacts/${contact.id}`);
          }
        }}
      />
    </div>
  );
}
