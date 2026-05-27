import { createSignal, createResource, For, Show } from 'solid-js';
import { A, useNavigate } from '@solidjs/router';
import { api } from '../lib/api';
import { ContactFormModal } from '../components/FormModals';
import Button from '../components/Button';

export default function ContactList() {
  const [search, setSearch] = createSignal('');
  const [company, setCompany] = createSignal('');
  const [modalOpen, setModalOpen] = createSignal(false);
  const navigate = useNavigate();

  const [companies, { refetch: refetchCompanies }] = createResource(() => api.getContactCompanies());

  const [contacts, { refetch }] = createResource(
    () => ({ company: company(), search: search() }),
    (params) => api.getAllContacts({
      company: params.company || undefined,
      search: params.search || undefined,
    })
  );

  return (
    <div>
      <div class="flex flex-col gap-3 mb-6 md:flex-row md:justify-between md:items-center">
        <h1 class="text-[26px] font-bold font-[family-name:var(--font-display)]">Contacts</h1>
        <Button variant="primary" onClick={() => setModalOpen(true)}>+ New Contact</Button>
      </div>

      <div class="flex flex-col gap-3 mb-6 md:flex-row md:items-center md:flex-wrap">
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

        <select
          class="input-vintage cursor-pointer w-full md:max-w-[220px]"
          value={company()}
          onChange={(e) => setCompany(e.currentTarget.value)}
        >
          <option value="">All Companies</option>
          <For each={companies() || []}>
            {(c) => (
              <option value={c.slug}>{c.name} ({c.contact_count})</option>
            )}
          </For>
        </select>
      </div>

      <Show when={!contacts.loading} fallback={<div class="text-base-300 p-10 text-center">Loading...</div>}>
        <div class="panel panel-accent">
          <For each={contacts() || []} fallback={<div class="text-base-300 text-center p-10 text-sm">No contacts found</div>}>
            {(c) => (
              <A href={`/contacts/${c.id}`} class="press-row gap-4 border-b border-base-700 last:border-b-0 flex-wrap">
                <span class="flex-1 font-semibold text-sm text-base-50">{c.full_name}</span>
                <span class="text-base-300 text-[12px]">{c.title || ''}</span>
                <Show when={c.account_names}>
                  <span class="text-base-300 text-[12px]">{c.account_names}</span>
                </Show>
                <Show when={c.email}><span class="text-base-300 text-[12px]">{c.email}</span></Show>
              </A>
            )}
          </For>
        </div>
      </Show>

      <ContactFormModal
        open={modalOpen()}
        onClose={() => setModalOpen(false)}
        onSaved={(contact) => {
          refetch();
          refetchCompanies();
          navigate(`/contacts/${contact.id}`);
        }}
      />
    </div>
  );
}
