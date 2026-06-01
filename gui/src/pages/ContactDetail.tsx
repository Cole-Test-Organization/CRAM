import { createResource, createSignal, createEffect, onCleanup, Show, For } from 'solid-js';
import { A, useParams, useNavigate } from '@solidjs/router';
import { api } from '../lib/api';
import { ContactFormModal } from '../components/FormModals';
import Button from '../components/Button';
import NotesPanel from '../components/NotesPanel';
import BackLink from '../components/BackLink';
import { attendeeStatusClass, attendeeStatusLabel } from '../lib/attendeeStatus';
import type { ContactMeeting } from '../lib/types';

type EnrichmentJob = {
  jobId: string;
  contactId: number;
  name: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  stage: string | null;
  error: string | null;
  patched: Record<string, string> | null;
  createdAt: string;
  completedAt: string | null;
};

export default function ContactDetail() {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [contact, { refetch }] = createResource(() => params.id, (id) => api.getContact(Number(id)));
  const [editOpen, setEditOpen] = createSignal(false);
  const [enrichJobs, setEnrichJobs] = createSignal<EnrichmentJob[]>([]);
  const [researchError, setResearchError] = createSignal<string | null>(null);
  const [starting, setStarting] = createSignal(false);

  // Same polling pattern as MeetingView — poll every 5s while any job is in
  // flight, then refetch the contact once everything settles so the patched
  // fields show up.
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSawActive = false;

  const fetchJobs = async (contactId: number) => {
    try {
      const { jobs } = await api.listContactEnrichmentJobs(contactId);
      setEnrichJobs(jobs);
      const hasActive = jobs.some(j => j.status === 'queued' || j.status === 'running');
      if (lastSawActive && !hasActive) {
        refetch();
      }
      lastSawActive = hasActive;
      if (hasActive) {
        pollTimer = setTimeout(() => fetchJobs(contactId), 5000);
      }
    } catch {
      // transient — back off
    }
  };

  createEffect(() => {
    const c = contact();
    if (!c) return;
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    lastSawActive = false;
    fetchJobs(c.id);
  });

  onCleanup(() => {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  });

  const activeJobCount = () => enrichJobs().filter(j => j.status === 'queued' || j.status === 'running').length;
  const completedJobCount = () => enrichJobs().filter(j => j.status === 'completed').length;
  const failedJobCount = () => enrichJobs().filter(j => j.status === 'failed').length;
  const hasActiveJob = () => activeJobCount() > 0;

  const startResearch = async () => {
    const c = contact();
    if (!c) return;
    if (hasActiveJob()) return;
    setStarting(true);
    setResearchError(null);
    try {
      await api.researchContact(c.id);
      // Restart the poller immediately so the queued job shows up in the panel.
      if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
      lastSawActive = false;
      await fetchJobs(c.id);
    } catch (err: any) {
      setResearchError(err?.message || 'Failed to start research');
    } finally {
      setStarting(false);
    }
  };

  const deleteContact = async () => {
    const c = contact();
    if (!c) return;
    if (!confirm(`Delete contact "${c.full_name}"?`)) return;
    await api.deleteContact(c.id);
    navigate('/contacts');
  };

  return (
    <div>
      <BackLink fallbackHref="/contacts" fallbackLabel="Contacts" />

      <Show when={contact()} fallback={<div class="text-base-300 p-10 text-center">Loading...</div>}>
        {(c) => (
          <>
            <div class="flex flex-col gap-4 mb-6 md:flex-row md:justify-between md:items-start">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-3 flex-wrap">
                  <h1 class="text-[26px] font-bold font-[family-name:var(--font-display)]">{c().full_name}</h1>
                  <Show when={c().kind && c().kind !== 'account'}>
                    <span class={`text-[10px] uppercase tracking-wider font-bold ${c().kind === 'partner' ? 'text-surf-300' : 'text-scarlet-300'}`}>
                      {c().kind}
                    </span>
                  </Show>
                </div>
                <Show when={c().accounts?.length}>
                  <div class="mt-1 flex gap-2 flex-wrap">
                    <For each={c().accounts}>
                      {(acct: any) => (
                        <A href={`/accounts/${acct.slug}`} class="text-base-300 text-sm uppercase tracking-wider hover:text-surf-300">{acct.name}</A>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
              <div class="flex gap-3 items-center flex-wrap">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={startResearch}
                  disabled={starting() || hasActiveJob()}
                >
                  {hasActiveJob() ? 'Researching…' : starting() ? 'Starting…' : 'Research'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setEditOpen(true)}>Edit</Button>
                <Button variant="danger" size="sm" onClick={deleteContact}>Delete</Button>
              </div>
            </div>

            <Show when={researchError()}>
              <div class="panel panel-accent p-3 mb-4 border-scarlet-400">
                <span class="text-[12px] text-scarlet-400">{researchError()}</span>
              </div>
            </Show>

            <Show when={enrichJobs().length > 0}>
              <div class="panel panel-accent p-5 mb-4">
                <div class="flex items-baseline justify-between gap-2 flex-wrap mb-2">
                  <h3 class="text-[11px] font-bold uppercase tracking-widest text-surf-300">Research</h3>
                  <span class="text-[11px] text-base-400 uppercase tracking-wider">
                    {activeJobCount() > 0
                      ? `${activeJobCount()} running · ${completedJobCount()} done${failedJobCount() ? ` · ${failedJobCount()} failed` : ''}`
                      : `${completedJobCount()} done${failedJobCount() ? ` · ${failedJobCount()} failed` : ''}`}
                  </span>
                </div>
                <div class="flex flex-col gap-2">
                  <For each={enrichJobs()}>
                    {(j) => {
                      const statusColor = () => {
                        if (j.status === 'completed') return 'border-surf-300 text-surf-300';
                        if (j.status === 'failed') return 'border-scarlet-400 text-scarlet-400';
                        return 'border-amber-300 text-amber-300';
                      };
                      const statusLabel = () => {
                        if (j.status === 'queued') return 'Queued';
                        if (j.status === 'running') return j.stage ? j.stage.charAt(0).toUpperCase() + j.stage.slice(1) : 'Running';
                        if (j.status === 'completed') return 'Done';
                        if (j.status === 'failed') return 'Failed';
                        return j.status;
                      };
                      return (
                        <div class="border-2 border-base-700 bg-base-950 p-2 flex items-center gap-3 flex-wrap">
                          <span class="text-sm font-semibold text-base-50">
                            {new Date(j.createdAt).toLocaleString()}
                          </span>
                          <span class={`bg-base-950 border-2 ${statusColor()} text-[10px] px-1.5 py-0.5 uppercase tracking-widest font-bold leading-none`}>
                            {statusLabel()}
                          </span>
                          <Show when={j.status === 'completed' && j.patched}>
                            <span class="text-[11px] text-base-300">
                              Updated: {Object.keys(j.patched!).join(', ')}
                            </span>
                          </Show>
                          <Show when={j.status === 'failed' && j.error}>
                            <span class="text-[11px] text-scarlet-400 truncate">{j.error}</span>
                          </Show>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </div>
            </Show>

            <div class="panel panel-accent p-5">
              <Show when={c().title}><div class="text-[13px] text-base-300 my-0.5"><strong class="text-surf-300 uppercase text-[11px] tracking-widest">Title:</strong> {c().title}</div></Show>
              <Show when={c().email}><div class="text-[13px] text-base-300 my-0.5"><strong class="text-surf-300 uppercase text-[11px] tracking-widest">Email:</strong> <a href={`mailto:${c().email}`}>{c().email}</a></div></Show>
              <Show when={c().phone}><div class="text-[13px] text-base-300 my-0.5"><strong class="text-surf-300 uppercase text-[11px] tracking-widest">Phone:</strong> {c().phone}</div></Show>
              <Show when={c().linkedin}><div class="text-[13px] text-base-300 my-0.5"><strong class="text-surf-300 uppercase text-[11px] tracking-widest">LinkedIn:</strong> <a href={c().linkedin} target="_blank">{c().linkedin}</a></div></Show>
              <Show when={c().notes}><div class="text-[13px] text-base-50 mt-3 whitespace-pre-wrap">{c().notes}</div></Show>
              <Show when={!c().title && !c().email && !c().phone && !c().linkedin && !c().notes}>
                <span class="text-base-300 text-[13px] italic">No details yet. Click Edit to add them.</span>
              </Show>
            </div>

            <div class="panel panel-accent p-5 mt-5">
              <h3 class="text-[11px] font-bold uppercase tracking-widest text-surf-300 mb-3">
                Meetings ({c().meetings?.length || 0})
              </h3>
              <Show
                when={c().meetings?.length}
                fallback={<span class="text-base-300 text-[13px] italic">No meetings recorded yet.</span>}
              >
                <div class="flex flex-col gap-2">
                  <For each={c().meetings}>
                    {(mtg: ContactMeeting) => (
                      <A
                        href={`/meetings/${mtg.id}`}
                        class="border-2 border-base-700 bg-base-950 px-3 py-2.5 flex items-center gap-x-3 gap-y-1.5 flex-wrap hover:border-surf-300 hover:shadow-[2px_2px_0_0_var(--color-surf-300)] transition-all"
                      >
                        {/* Title takes the full row on mobile so the meta below wraps
                            under it; shares the line on desktop (md:min-w-0). */}
                        <span class="flex-1 min-w-full md:min-w-0 text-sm font-semibold text-base-50 flex items-center gap-2 flex-wrap">
                          <Show when={mtg.internal}>
                            <span class="bg-base-950 border-2 border-surf-300 text-surf-300 text-[10px] px-1.5 py-0.5 uppercase tracking-widest font-bold leading-none shrink-0">Internal</span>
                          </Show>
                          {/* No truncate: let long titles wrap within the column (mobile)
                              rather than force horizontal page overflow. Matches MeetingsList. */}
                          <span class="break-words">{mtg.title || '(no title)'}</span>
                        </span>
                        {/* Meta — shrink-0 so a long title can't squeeze these to 0 width. */}
                        <Show when={mtg.status}>
                          <span class={`shrink-0 text-[10px] leading-none px-1.5 py-0.5 border ${attendeeStatusClass(mtg.status!)}`}>
                            {attendeeStatusLabel(mtg.status!)}
                          </span>
                        </Show>
                        <Show when={!mtg.internal && mtg.account_name}>
                          <span class="shrink-0 text-[11px] uppercase tracking-wider text-base-400">{mtg.account_name}</span>
                        </Show>
                        <span class="shrink-0 text-[12px] text-base-300 uppercase tracking-wider tabular-nums">{mtg.date}</span>
                      </A>
                    )}
                  </For>
                </div>
              </Show>
            </div>

            <div class="mt-5">
              <NotesPanel target={{ contact_id: c().id }} />
            </div>

            <ContactFormModal
              open={editOpen()}
              onClose={() => setEditOpen(false)}
              existing={c()}
              onSaved={() => refetch()}
            />
          </>
        )}
      </Show>
    </div>
  );
}
