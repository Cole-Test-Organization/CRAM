import { createResource, createSignal, For, Show } from 'solid-js';
import { A, useNavigate } from '@solidjs/router';
import { api } from '../lib/api';
import { MeetingFormModal } from '../components/FormModals';
import Button from '../components/Button';

export default function MeetingsList() {
  const [filter, setFilter] = createSignal('');
  const [modalOpen, setModalOpen] = createSignal(false);
  const navigate = useNavigate();
  const [meetings, { refetch }] = createResource(() => api.getAllMeetings({ limit: 100000 }));

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

  return (
    <div>
      <div class="flex flex-col gap-3 mb-6 md:flex-row md:justify-between md:items-center">
        <h1 class="text-[26px] font-bold font-[family-name:var(--font-display)]">Meetings</h1>
        <div class="flex items-center gap-4 flex-wrap">
          <span class="text-base-300 text-[12px] uppercase tracking-wider">{filtered().length} meetings</span>
          <Button variant="primary" onClick={() => setModalOpen(true)}>+ New Meeting</Button>
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

      <div class="panel panel-accent">
        <Show when={!meetings.loading} fallback={<div class="text-base-300 p-10 text-center">Loading...</div>}>
          <For each={filtered()} fallback={<div class="text-base-300 text-center p-10 text-sm">No meetings found</div>}>
            {(m: any) => (
              <A href={`/meetings/${m.id}`} class="press-row gap-4 flex-wrap border-b border-base-700 last:border-b-0">
                <span class="flex-1 min-w-full md:min-w-0 font-semibold text-sm text-base-50 flex items-center gap-2 flex-wrap">
                  <Show when={m.internal}>
                    <span class="bg-base-950 border-2 border-surf-300 text-surf-300 text-[10px] px-1.5 py-0.5 uppercase tracking-widest font-bold leading-none">Internal</span>
                  </Show>
                  <span>{m.title || m.filename}</span>
                </span>
                <span class="text-base-300 text-[12px]">{m.internal ? '' : m.account_name}</span>
                <span class="text-base-300 text-[12px]">{m.date}</span>
              </A>
            )}
          </For>
        </Show>
      </div>

      <MeetingFormModal
        open={modalOpen()}
        onClose={() => setModalOpen(false)}
        onSaved={(m) => {
          refetch();
          navigate(`/meetings/${m.id}`);
        }}
      />
    </div>
  );
}
