import { createResource, createSignal, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { api } from '../lib/api';
import { MeetingFormModal } from '../components/FormModals';
import Button from '../components/Button';
import ListRows from '../components/ListRows';
import TodayTimeline from '../components/TodayTimeline';
import SelectionToolbar from '../components/SelectionToolbar';
import { createSelection } from '../components/createSelection';
import { buildMeetingsExport } from '../lib/meetingExport';

type Props = {
  // When set, the list is scoped to this account's meetings (via the per-account
  // endpoint) and the New Meeting modal is pinned to that account. When unset,
  // this is the standalone /meetings page: shows all meetings, the H1, and the
  // account-name column, and navigates to the new meeting after creation.
  accountId?: number;
  accountName?: string;
  onAfterCreate?: (meeting: any) => void;
  onAfterDelete?: () => void;
};

export default function MeetingsList(props: Props = {}) {
  const [filter, setFilter] = createSignal('');
  const [modalOpen, setModalOpen] = createSignal(false);
  const navigate = useNavigate();

  const isEmbedded = () => props.accountId !== undefined && props.accountId !== null;

  const [meetings, { refetch }] = createResource(
    () => ({ accountId: props.accountId }),
    async ({ accountId }) => {
      if (accountId !== undefined && accountId !== null) return api.getMeetings(accountId);
      return api.getAllMeetings({ limit: 100000 });
    }
  );

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

  const sel = createSelection(
    () => filtered().map((m: any) => m.id),
    () => props.accountId,
  );

  const deleteMeeting = async (id: number) => {
    if (!confirm('Delete this meeting?')) return;
    await api.deleteMeeting(id);
    sel.remove(id);
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

      <Show when={!isEmbedded()}>
        <TodayTimeline meetings={() => meetings() || []} getHref={(m: any) => `/meetings/${m.id}`} />
      </Show>

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

      <SelectionToolbar selection={sel} buildExport={buildMeetingsExport} loading={() => meetings.loading} />

      <ListRows
        items={filtered}
        loading={() => meetings.loading}
        getId={(m: any) => m.id}
        getHref={(m: any) => `/meetings/${m.id}`}
        renderRow={(m: any) => (
          <>
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
          </>
        )}
        selection={sel}
        onDelete={deleteMeeting}
        deleteTitle="Delete meeting"
        emptyState={<div class="text-base-300 text-center p-10 text-sm">No meetings found</div>}
      />

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
