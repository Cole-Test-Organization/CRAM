import { createSignal, createResource, For, Show, createMemo } from 'solid-js';
import { api } from '../lib/api';
import { formInputClass, formSelectClass } from './FormField';
import { modalBtn } from './Modal';

interface AccountPickerProps {
  value: { id: number; name: string; slug: string } | null;
  onChange: (account: { id: number; name: string; slug: string } | null) => void;
  placeholder?: string;
  excludePartner?: boolean;
}

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export default function AccountPicker(props: AccountPickerProps) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [mode, setMode] = createSignal<'pick' | 'create'>('pick');
  const [accounts, { refetch }] = createResource(() => api.getAccounts({ sort: 'name' }));

  const [newName, setNewName] = createSignal('');
  const [newSlug, setNewSlug] = createSignal('');
  const [newStatus, setNewStatus] = createSignal('account');
  const [slugTouched, setSlugTouched] = createSignal(false);
  const [creating, setCreating] = createSignal(false);
  const [createError, setCreateError] = createSignal('');

  const filtered = createMemo(() => {
    let list = accounts()?.accounts || [];
    if (props.excludePartner) list = list.filter((a: any) => a.status !== 'partner');
    const q = query().toLowerCase().trim();
    if (!q) return list;
    return list.filter((a: any) =>
      a.name.toLowerCase().includes(q) || a.slug.includes(q)
    );
  });

  const select = (acct: any) => {
    props.onChange({ id: acct.id, name: acct.name, slug: acct.slug });
    setOpen(false);
    setQuery('');
  };

  const startCreate = () => {
    setMode('create');
    setNewName(query());
    setNewSlug(slugify(query()));
    setSlugTouched(false);
    setCreateError('');
  };

  const cancelCreate = () => {
    setMode('pick');
    setNewName('');
    setNewSlug('');
    setSlugTouched(false);
    setCreateError('');
  };

  const submitCreate = async () => {
    if (!newName().trim()) {
      setCreateError('Name is required');
      return;
    }
    const slug = newSlug().trim() || slugify(newName());
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug)) {
      setCreateError('Slug must be lowercase letters, numbers, and hyphens');
      return;
    }
    setCreating(true);
    setCreateError('');
    try {
      const payload: any = { name: newName().trim(), slug };
      if (newStatus()) payload.status = newStatus();
      const acct = await api.createAccount(payload);
      await refetch();
      select(acct);
      setMode('pick');
      setNewName('');
      setNewSlug('');
    } catch (err: any) {
      const msg = err?.message || 'Failed to create account';
      setCreateError(msg.includes('409') ? 'An account with this slug already exists' : msg);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div class="relative">
      <button
        type="button"
        class="input-vintage text-left flex items-center justify-between cursor-pointer"
        onClick={() => setOpen(!open())}
      >
        <span class={props.value ? 'text-base-50' : 'text-base-400'}>
          {props.value ? props.value.name : (props.placeholder || 'Select account...')}
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-surf-400">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      <Show when={open()}>
        <div class="absolute left-0 right-0 top-full mt-1 z-50 bg-base-900 border-2 border-base-500 shadow-[4px_4px_0_0_var(--color-base-600)] max-h-[360px] flex flex-col">
          <Show when={mode() === 'pick'} fallback={
            <div class="p-3">
              <div class="text-[10px] uppercase text-surf-300 tracking-widest font-bold mb-2">New Account</div>
              <input
                class={`${formInputClass} mb-2`}
                placeholder="Company name"
                value={newName()}
                onInput={(e) => {
                  const val = e.currentTarget.value;
                  setNewName(val);
                  if (!slugTouched()) setNewSlug(slugify(val));
                }}
                autofocus
              />
              <input
                class={`${formInputClass} mb-2`}
                placeholder="slug-for-url"
                value={newSlug()}
                onInput={(e) => {
                  setSlugTouched(true);
                  setNewSlug(e.currentTarget.value);
                }}
              />
              <select
                class={`${formSelectClass} mb-2`}
                value={newStatus()}
                onChange={(e) => setNewStatus(e.currentTarget.value)}
              >
                <option value="account">Account</option>
                <option value="partner">Partner</option>
              </select>
              <Show when={createError()}>
                <div class="text-[11px] text-scarlet-400 mb-2 font-semibold">{createError()}</div>
              </Show>
              <div class="flex gap-3 justify-end">
                <button
                  type="button"
                  class={modalBtn.secondary}
                  onClick={cancelCreate}
                  disabled={creating()}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  class={modalBtn.primary}
                  onClick={submitCreate}
                  disabled={creating()}
                >
                  {creating() ? 'Creating...' : 'Create'}
                </button>
              </div>
            </div>
          }>
            <div class="p-2 border-b-2 border-base-600">
              <input
                class={formInputClass}
                placeholder="Search accounts..."
                value={query()}
                onInput={(e) => setQuery(e.currentTarget.value)}
                autofocus
              />
            </div>
            <div class="flex-1 overflow-y-auto">
              <Show when={!accounts.loading} fallback={<div class="text-base-300 p-3 text-center text-sm">Loading...</div>}>
                <For each={filtered()}>
                  {(acct: any) => (
                    <button
                      type="button"
                      data-testid="account-option"
                      class="press-row w-full text-left border-b border-base-700 last:border-b-0"
                      onClick={() => select(acct)}
                    >
                      <span class="flex-1 text-base-50 text-sm font-semibold">{acct.name}</span>
                      <span class="text-base-400 text-[11px] uppercase tracking-wider">{acct.status || ''}</span>
                    </button>
                  )}
                </For>
                <Show when={filtered().length === 0}>
                  <div class="text-base-300 p-3 text-center text-[13px]">No accounts match "{query()}"</div>
                </Show>
              </Show>
            </div>
            <button
              type="button"
              class="w-full text-left px-3 py-2 text-[12px] font-bold uppercase tracking-wider text-surf-300 border-t-2 border-base-600 bg-base-800 transition-colors duration-150 hover:bg-base-700 cursor-pointer"
              onClick={startCreate}
            >
              + Create new account{query() ? ` "${query()}"` : ''}
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
}
