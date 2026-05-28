import { createResource, createSignal, createEffect, For, Show } from 'solid-js';
import { A, useNavigate } from '@solidjs/router';
import { api } from '../lib/api';
import { MeetingFormModal } from '../components/FormModals';
import Button from '../components/Button';
import ExportActions from '../components/ExportActions';
import { buildMeetingsExport } from '../lib/meetingExport';

type Props = {
  // When set, the list is scoped to this account's meetings (via the per-account
  // endpoint) and the New Meeting modal is pinned to that account. When unset,
  // this is the standalone /meetings page: shows all meetings, the H1, and the
  // account-name column, and navigates to the new meeting after creation.
  accountId?: number;
  accountName?: string;
  // Notify the embedding parent so it can refetch its own data (e.g. to update
  // a meetings tab count). The list refetches itself automatically; this is
  // strictly for the parent.
  onAfterCreate?: (meeting: any) => void;
  onAfterDelete?: () => void;
};

export default function MeetingsList(props: Props = {}) {
  const [filter, setFilter] = createSignal('');
  const [modalOpen, setModalOpen] = createSignal(false);
  const [selectedIds, setSelectedIds] = createSignal<Set<number>>(new Set<number>());
  const navigate = useNavigate();

  const isEmbedded = () => props.accountId !== undefined && props.accountId !== null;

  // Object source keeps the resource always-truthy so it fetches even when
  // accountId is undefined (the all-meetings page mode).
  const [meetings, { refetch }] = createResource(
    () => ({ accountId: props.accountId }),
    async ({ accountId }) => {
      if (accountId !== undefined && accountId !== null) return api.getMeetings(accountId);
      return api.getAllMeetings({ limit: 100000 });
    }
  );

  // Drop any stale selection when the scope changes.
  createEffect(() => {
    void props.accountId;
    setSelectedIds(new Set<number>());
  });

  const filtered = () => {
    const q = filter().toLowerCase();
    const list = meetings() || [];
    if (!q) return list;
    return list.filter((m: any) =>
      (m.title || m.filename || '').toLowerCase().includes(q) ||
      (m.account_name || '').toLowerCase().includes(q) ||
      (m.attendees || '').toLowerCase().includes(q) ||
      (m.date || '').includes(q) ||
      (m.internal && 'internal'.includes(q))
    );
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const visibleIds = () => filtered().map((m: any) => m.id as number);

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
      if (allVisibleSelected()) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set<number>());

  const selectedCount = () => selectedIds().size;
  const selectedIdList = () => Array.from(selectedIds());

  const deleteMeeting = async (id: number) => {
    if (!confirm('Delete this meeting?')) return;
    await api.deleteMeeting(id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    refetch();
    props.onAfterDelete?.();
  };

  return (
    <div>
      <div class="flex flex-col gap-3 mb-6 md:flex-row md:items-center">
        <Show when={!isEmbedded()}>
          <h1 class="text-[26px] font-bold font-[family-name:var(--font-display)]">Meetings</h1>
        </Show>
        <div class="flex items-center gap-4 flex-wrap md:ml-auto">
          <span class="text-base-300 text-[12px] uppercase tracking-wider">{filtered().length} meeting{filtered().length === 1 ? '' : 's'}</span>
          <Button variant="primary" size={isEmbedded() ? 'sm' : 'md'} onClick={() => setModalOpen(true)}>+ New Meeting</Button>
        </div>
      </div>

      <div class="mb-5">
        <div class="flex items-center bg-base-950 border-2 border-base-500 px-3 py-2 gap-2 focus-within:border-surf-300 transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-surf-400"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input
            type="text"
            placeholder="Filter meetings..."
            value={filter()}
            onInput={(e) => setFilter(e.currentTarget.value)}
            class="flex-1 bg-transparent border-none outline-none text-base-50 text-sm placeholder:text-base-400"
          />
        </div>
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
        <ExportActions ids={selectedIdList} build={buildMeetingsExport} disabled={() => meetings.loading} />
      </div>

      <div class="panel panel-accent">
        <Show when={!meetings.loading} fallback={<div class="text-base-300 p-10 text-center">Loading...</div>}>
          <For each={filtered()} fallback={<div class="text-base-300 text-center p-10 text-sm">No meetings found</div>}>
            {(m: any) => (
              <div class="flex items-center border-b border-base-700 last:border-b-0">
                <label class="flex items-center self-stretch pl-3 pr-1 cursor-pointer">
                  <input
                    type="checkbox"
                    class="accent-surf-400 w-4 h-4 cursor-pointer"
                    checked={selectedIds().has(m.id)}
                    onChange={() => toggleSelect(m.id)}
                  />
                </label>
                <A href={`/meetings/${m.id}`} class="press-row gap-4 flex-wrap flex-1 min-w-0">
                  <span class="flex-1 min-w-full md:min-w-0 font-semibold text-sm text-base-50 flex items-center gap-2 flex-wrap">
                    <Show when={m.internal}>
                      <span class="bg-base-950 border-2 border-surf-300 text-surf-300 text-[10px] px-1.5 py-0.5 uppercase tracking-widest font-bold leading-none">Internal</span>
                    </Show>
                    <span>{m.title || m.filename}</span>
                  </span>
                  <Show when={!isEmbedded()}>
                    <span class="text-base-300 text-[12px]">{m.internal ? '' : m.account_name}</span>
                  </Show>
                  <span class="text-base-300 text-[12px]">{m.date}</span>
                </A>
                <button
                  class="btn-x mr-2 md:mr-3 shrink-0"
                  onClick={() => deleteMeeting(m.id)}
                  title="Delete meeting"
                >
                  ×
                </button>
              </div>
            )}
          </For>
        </Show>
      </div>

      <MeetingFormModal
        open={modalOpen()}
        onClose={() => setModalOpen(false)}
        fixedAccountId={props.accountId}
        fixedAccountName={props.accountName}
        onSaved={(m) => {
          refetch();
          if (props.onAfterCreate) {
            props.onAfterCreate(m);
          } else {
            navigate(`/meetings/${m.id}`);
          }
        }}
      />
    </div>
  );
}
