import { createSignal, createResource, createMemo, For, Show } from 'solid-js';
import { api } from '../lib/api';
import { formInputClass } from './FormField';

type ContactOption = {
  id: number;
  full_name: string;
  email?: string;
  title?: string;
  company?: string;
  kind: 'account' | 'partner' | 'internal';
  partner_account_name?: string;
  partner_account_slug?: string;
};

interface AttendeePickerProps {
  mode: 'external' | 'internal';
  accountId?: number | null;
  value: number[];
  onChange: (ids: number[]) => void;
}

export default function AttendeePicker(props: AttendeePickerProps) {
  const [query, setQuery] = createSignal('');

  const optionsKey = () =>
    props.mode === 'external'
      ? (props.accountId ? { mode: 'external' as const, accountId: props.accountId } : null)
      : { mode: 'internal' as const };

  const [options] = createResource(optionsKey, async (key) => {
    if (!key) return { account: [], partner: [], internal: [] };
    return api.getAttendeeOptions(key);
  });

  const buckets = createMemo(() => {
    const o = options() || { account: [], partner: [], internal: [] };
    const q = query().toLowerCase().trim();
    const filter = (list: ContactOption[] = []) =>
      !q
        ? list
        : list.filter((c) =>
            (c.full_name || '').toLowerCase().includes(q) ||
            (c.email || '').toLowerCase().includes(q) ||
            (c.title || '').toLowerCase().includes(q) ||
            (c.company || '').toLowerCase().includes(q) ||
            (c.partner_account_name || '').toLowerCase().includes(q)
          );
    return {
      account: filter((o.account || []) as ContactOption[]),
      partner: filter((o.partner || []) as ContactOption[]),
      internal: filter((o.internal || []) as ContactOption[]),
    };
  });

  const selectedContacts = createMemo(() => {
    const o = options();
    if (!o) return [] as ContactOption[];
    const all = [...(o.account || []), ...(o.partner || []), ...(o.internal || [])] as ContactOption[];
    const byId = new Map(all.map((c) => [c.id, c]));
    return props.value.map((id) => byId.get(id)).filter(Boolean) as ContactOption[];
  });

  const toggle = (id: number) => {
    const current = props.value;
    if (current.includes(id)) {
      props.onChange(current.filter((v) => v !== id));
    } else {
      props.onChange([...current, id]);
    }
  };

  const remove = (id: number) => {
    props.onChange(props.value.filter((v) => v !== id));
  };

  const needsAccount = () => props.mode === 'external' && !props.accountId;

  const bucketOrder = () => (props.mode === 'external'
    ? (['account', 'partner', 'internal'] as const)
    : (['internal', 'partner'] as const));

  const bucketLabel = (k: 'account' | 'partner' | 'internal') => {
    switch (k) {
      case 'account': return 'This Account';
      case 'partner': return 'Partners';
      case 'internal': return 'Internal';
    }
  };

  const isEmpty = () => {
    const b = buckets();
    return b.account.length === 0 && b.partner.length === 0 && b.internal.length === 0;
  };

  return (
    <div class="bg-base-950 border-2 border-base-500">
      <Show when={!needsAccount()} fallback={
        <div class="text-base-400 p-3 text-[13px]">Select an account first</div>
      }>
        <Show when={selectedContacts().length > 0}>
          <div class="flex flex-wrap gap-1.5 p-2 border-b-2 border-base-700 bg-base-900">
            <For each={selectedContacts()}>
              {(c) => (
                <span class="inline-flex items-center gap-1.5 bg-base-800 border border-base-500 px-2 py-0.5 text-[12px] text-base-50">
                  <span class="font-semibold">{c.full_name}</span>
                  <Show when={c.kind !== 'account'}>
                    <span class={`text-[10px] uppercase tracking-wider ${c.kind === 'partner' ? 'text-surf-300' : 'text-scarlet-300'}`}>
                      {c.kind === 'partner' ? (c.partner_account_name || 'partner') : 'internal'}
                    </span>
                  </Show>
                  <button
                    type="button"
                    class="text-base-400 hover:text-scarlet-400 cursor-pointer font-bold px-0.5"
                    onClick={() => remove(c.id)}
                    aria-label={`Remove ${c.full_name}`}
                  >
                    &times;
                  </button>
                </span>
              )}
            </For>
          </div>
        </Show>

        <div class="p-2 border-b-2 border-base-700">
          <input
            class={formInputClass}
            placeholder={props.mode === 'external' ? 'Search attendees...' : 'Search internal + partners...'}
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
        </div>

        <div class="max-h-[40vh] md:max-h-[260px] overflow-y-auto">
          <Show when={!options.loading} fallback={<div class="text-base-300 p-3 text-center text-sm">Loading...</div>}>
            <Show when={!isEmpty()} fallback={
              <div class="text-base-400 p-3 text-center text-[13px]">
                {query() ? 'No matches' : 'No contacts available'}
              </div>
            }>
              <For each={bucketOrder()}>
                {(bucketKey) => {
                  const list = () => buckets()[bucketKey] as ContactOption[];
                  return (
                    <Show when={list().length > 0}>
                      <div class="px-3 py-1.5 text-[10px] uppercase tracking-widest text-surf-300 font-bold bg-base-900 border-b border-base-700 sticky top-0">
                        {bucketLabel(bucketKey)}
                        <span class="ml-1.5 text-base-400">({list().length})</span>
                      </div>
                      <For each={list()}>
                        {(c) => (
                          <label class="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer border-b border-base-700 last:border-b-0 transition-colors duration-150 hover:bg-base-800">
                            <input
                              type="checkbox"
                              class="accent-surf-400 w-4 h-4 cursor-pointer"
                              checked={props.value.includes(c.id)}
                              onChange={() => toggle(c.id)}
                            />
                            <span class="flex-1 text-base-50 font-semibold">{c.full_name}</span>
                            <Show when={c.title}>
                              <span class="text-base-400 text-[11px] uppercase tracking-wider">{c.title}</span>
                            </Show>
                            <Show when={bucketKey === 'partner' && c.partner_account_name}>
                              <span class="text-surf-300 text-[11px] uppercase tracking-wider">{c.partner_account_name}</span>
                            </Show>
                          </label>
                        )}
                      </For>
                    </Show>
                  );
                }}
              </For>
            </Show>
          </Show>
        </div>
      </Show>
    </div>
  );
}
