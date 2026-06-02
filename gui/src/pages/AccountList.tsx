import { createResource, createSignal, For, Show } from 'solid-js';
import { A, useNavigate } from '@solidjs/router';
import { api } from '../lib/api';
import { AccountFormModal } from '../components/FormModals';
import Button from '../components/Button';

export default function AccountList(props: { type?: 'account' | 'partner' }) {
  const [filter, setFilter] = createSignal('');
  const [reviewOnly, setReviewOnly] = createSignal(false);
  const [modalOpen, setModalOpen] = createSignal(false);
  const navigate = useNavigate();

  // Accounts list: everything that isn't a partner. Partners list: just partners.
  // Other callers (none today) get the unfiltered set.
  const [data, { refetch, mutate }] = createResource(
    () => props.type,
    (type) => {
      if (type === 'partner') return api.getAccounts({ status: 'partner', sort: 'name' });
      if (type === 'account') return api.getAccounts({ exclude_status: 'partner', sort: 'name' });
      return api.getAccounts({ sort: 'name' });
    }
  );

  const filtered = () => {
    const q = filter().toLowerCase();
    let accounts = data()?.accounts || [];
    if (reviewOnly()) accounts = accounts.filter((a: any) => a.needs_review);
    if (!q) return accounts;
    return accounts.filter((a: any) => a.name.toLowerCase().includes(q) || a.slug.includes(q));
  };

  // Accounts flagged for review (e.g. auto-created by the notes importer).
  const reviewCount = () => (data()?.accounts || []).filter((a: any) => a.needs_review).length;

  const favorites = () => filtered().filter((a: any) => a.favorite);
  const regulars = () => filtered().filter((a: any) => !a.favorite);

  const title = () => {
    if (props.type === 'partner') return 'Partners';
    return 'Accounts';
  };

  const singular = () => {
    if (props.type === 'partner') return 'Partner';
    return 'Account';
  };

  // Toggle favorite optimistically — re-sort favorites to the top to match the
  // server ordering (favorite DESC, name ASC). On error, revert to the snapshot.
  const toggleFavorite = async (acct: any) => {
    const current = data();
    if (!current) return;
    const next = !acct.favorite;
    const updated = current.accounts
      .map((a: any) => (a.id === acct.id ? { ...a, favorite: next } : a))
      .sort((a: any, b: any) => {
        if (!!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1;
        return (a.name || '').localeCompare(b.name || '');
      });
    mutate({ ...current, accounts: updated });
    try {
      await api.patchAccount(acct.id, { favorite: next });
    } catch {
      mutate(current);
    }
  };

  // Clear the review flag once an auto-created account has been eyeballed.
  // Optimistic: drop the badge immediately, revert on error.
  const verify = async (acct: any) => {
    const current = data();
    if (!current) return;
    const updated = current.accounts.map((a: any) => (a.id === acct.id ? { ...a, needs_review: false } : a));
    mutate({ ...current, accounts: updated });
    try {
      await api.patchAccount(acct.id, { needs_review: false });
    } catch {
      mutate(current);
    }
  };

  return (
    <div>
      <div class="flex flex-col gap-3 mb-6 md:flex-row md:justify-between md:items-center">
        <h1 class="text-[26px] font-bold font-[family-name:var(--font-display)]">{title()}</h1>
        <div class="flex items-center gap-4 flex-wrap">
          <span class="text-base-300 text-[12px] uppercase tracking-wider">{filtered().length} {title().toLowerCase()}</span>
          <Button variant="primary" onClick={() => setModalOpen(true)}>+ New {singular()}</Button>
        </div>
      </div>

      <div class="flex flex-col gap-3 mb-5 md:flex-row md:items-center">
        <div class="flex items-center bg-base-950 border-2 border-base-500 px-3 py-2 gap-2 flex-1 focus-within:border-surf-300 transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-surf-400"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input
            type="text"
            placeholder={`Filter ${title().toLowerCase()}...`}
            value={filter()}
            onInput={(e) => setFilter(e.currentTarget.value)}
            class="flex-1 bg-transparent border-none outline-none text-base-50 text-sm placeholder:text-base-400"
          />
        </div>
        <Show when={reviewCount() || reviewOnly()}>
          <label class="flex items-center gap-2 cursor-pointer text-[11px] uppercase tracking-wider font-semibold text-amber-300 shrink-0 px-1" title="Show only accounts flagged for review">
            <input type="checkbox" class="accent-amber-300 w-4 h-4 cursor-pointer" checked={reviewOnly()} onChange={(e) => setReviewOnly(e.currentTarget.checked)} />
            Needs review{reviewCount() ? ` (${reviewCount()})` : ''}
          </label>
        </Show>
      </div>

      <div class="panel panel-accent">
        <Show when={!data.loading} fallback={<div class="text-base-300 p-10 text-center">Loading...</div>}>
          <Show when={filtered().length} fallback={<div class="text-base-300 text-center p-10 text-sm">No {title().toLowerCase()} found</div>}>
            <Show when={favorites().length}>
              <div class="px-4 py-1.5 bg-base-900 border-b-2 border-amber-300/60 text-amber-300 text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                Favorites
              </div>
              <For each={favorites()}>
                {(acct) => <AccountRow acct={acct} onToggleFavorite={toggleFavorite} onVerify={verify} />}
              </For>
            </Show>
            <Show when={favorites().length && regulars().length}>
              <div class="px-4 py-1.5 bg-base-900 border-y border-base-600 text-base-300 text-[10px] font-bold uppercase tracking-widest">
                All {title().toLowerCase()}
              </div>
            </Show>
            <For each={regulars()}>
              {(acct) => <AccountRow acct={acct} onToggleFavorite={toggleFavorite} onVerify={verify} />}
            </For>
          </Show>
        </Show>
      </div>

      <AccountFormModal
        open={modalOpen()}
        onClose={() => setModalOpen(false)}
        onSaved={(acct) => {
          refetch();
          navigate(`/accounts/${acct.slug}`);
        }}
      />
    </div>
  );
}

function AccountRow(props: { acct: any; onToggleFavorite: (acct: any) => void; onVerify: (acct: any) => void }) {
  return (
    <div class="flex items-stretch border-b border-base-700 last:border-b-0">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); props.onToggleFavorite(props.acct); }}
        class={`shrink-0 flex items-center justify-center w-11 transition-colors ${props.acct.favorite ? 'text-amber-300' : 'text-base-500 hover:text-amber-300'}`}
        aria-label={props.acct.favorite ? 'Unfavorite' : 'Favorite'}
        title={props.acct.favorite ? 'Unfavorite' : 'Favorite'}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill={props.acct.favorite ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      </button>
      <A href={`/accounts/${props.acct.slug}`} class="press-row gap-4 flex-wrap flex-1 min-w-0">
        <span class="flex-1 min-w-[60%] md:min-w-0 font-semibold text-sm text-base-50 flex items-center gap-2 flex-wrap">
          <Show when={props.acct.needs_review}>
            <span class="bg-base-950 border-2 border-amber-300 text-amber-300 text-[10px] px-1.5 py-0.5 uppercase tracking-widest font-bold leading-none">Review</span>
          </Show>
          <span>{props.acct.name}</span>
        </span>
        <span class="text-base-300 text-[12px]">{props.acct.last_contact || '—'}</span>
      </A>
      <Show when={props.acct.needs_review}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); props.onVerify(props.acct); }}
          class="shrink-0 px-3 flex items-center text-[11px] uppercase tracking-wider font-bold text-amber-300 hover:text-surf-300 transition-colors"
          title="Mark as reviewed — clears the flag"
        >
          Verify
        </button>
      </Show>
    </div>
  );
}
