import { createResource, createSignal, createEffect, onCleanup, Show, For } from 'solid-js';
import { A, useParams, useNavigate } from '@solidjs/router';
import { api } from '../lib/api';
import MarkdownRenderer from '../components/MarkdownRenderer';
import { MeetingFormModal } from '../components/FormModals';
import Button from '../components/Button';
import BackLink from '../components/BackLink';
import ExportActions from '../components/ExportActions';
import { buildMeetingsExport } from '../lib/meetingExport';

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

// Per-meeting attendance/RSVP badge (from meeting_attendees.status). Reuses the
// existing palette: going/owner = surf (present), declined = scarlet, maybe =
// amber, invited/other = muted base.
const ATTENDEE_STATUS_LABEL: Record<string, string> = {
  going: 'Going', declined: 'Declined', maybe: 'Maybe', invited: 'Invited', owner: 'Owner',
};
function attendeeStatusClass(status: string): string {
  switch (status) {
    case 'going':
    case 'owner': return 'border-surf-300 text-surf-300';
    case 'declined': return 'border-scarlet-400 text-scarlet-400';
    case 'maybe': return 'border-amber-300 text-amber-300';
    default: return 'border-base-500 text-base-300';
  }
}

export default function MeetingView() {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [meeting, { refetch }] = createResource(() => Number(params.id), (id) => api.getMeeting(id));
  const [editOpen, setEditOpen] = createSignal(false);

  // Attendee-research progress panel. Polls every 5s while any job is still
  // in flight, then stops and refetches the meeting once everything has
  // terminated so the patched contact fields show up here.
  const [enrichJobs, setEnrichJobs] = createSignal<EnrichmentJob[]>([]);
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSawActive = false;

  const fetchJobs = async (meetingId: number) => {
    try {
      const { jobs } = await api.listMeetingEnrichmentJobs(meetingId);
      setEnrichJobs(jobs);
      const hasActive = jobs.some(j => j.status === 'queued' || j.status === 'running');
      if (lastSawActive && !hasActive) {
        // Just settled — pull the meeting again to reflect newly-patched contact fields.
        refetch();
      }
      lastSawActive = hasActive;
      if (hasActive) {
        pollTimer = setTimeout(() => fetchJobs(meetingId), 5000);
      }
    } catch {
      // Endpoint not available or transient — back off without spamming.
    }
  };

  createEffect(() => {
    const m = meeting();
    if (!m) return;
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    lastSawActive = false;
    fetchJobs(m.id);
  });

  onCleanup(() => {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  });

  const activeJobCount = () => enrichJobs().filter(j => j.status === 'queued' || j.status === 'running').length;
  const completedJobCount = () => enrichJobs().filter(j => j.status === 'completed').length;
  const failedJobCount = () => enrichJobs().filter(j => j.status === 'failed').length;

  const deleteMeeting = async () => {
    const m = meeting();
    if (!m) return;
    if (!confirm('Delete this meeting?')) return;
    await api.deleteMeeting(m.id);
    navigate(m.internal || !m.account_slug ? '/meetings' : `/accounts/${m.account_slug}`);
  };

  return (
    <div>
      <Show when={meeting()} fallback={<div class="text-base-300 p-10 text-center">Loading...</div>}>
        {(m) => (
          <>
            <BackLink
              fallbackHref={!m().internal && m().account_slug ? `/accounts/${m().account_slug}` : '/meetings'}
              fallbackLabel={!m().internal && m().account_slug ? m().account_name : 'Meetings'}
            />

            <div class="flex flex-col gap-4 mb-6 md:flex-row md:justify-between md:items-start">
              <div class="flex-1 min-w-0">
                <h1 class="text-[26px] font-bold font-[family-name:var(--font-display)] flex items-center gap-3 flex-wrap">
                  <Show when={m().internal}>
                    <span class="bg-base-950 border-2 border-surf-300 text-surf-300 text-[11px] px-2 py-0.5 uppercase tracking-widest font-bold leading-none">Internal</span>
                  </Show>
                  <span>{m().title || m().filename}</span>
                </h1>
                <div class="flex items-center gap-3 mt-1 flex-wrap text-base-300 text-[12px] uppercase tracking-wider">
                  <span>{m().date}</span>
                  <Show when={m().attendees}>
                    <span>· {m().attendees}</span>
                  </Show>
                </div>
              </div>
              <div class="flex gap-3 items-center flex-wrap">
                <ExportActions ids={() => [m().id]} build={buildMeetingsExport} />
                <Button variant="ghost" size="sm" onClick={() => setEditOpen(true)}>Edit</Button>
                <Button variant="danger" size="sm" onClick={deleteMeeting}>Delete</Button>
              </div>
            </div>

            <Show when={m().contacts?.length}>
              <div class="panel panel-accent p-5 mb-4">
                <h3 class="text-[11px] font-bold uppercase tracking-widest text-surf-300 mb-2">Attendees</h3>
                <div class="flex gap-2 flex-wrap">
                  <For each={m().contacts}>
                    {(c: any) => (
                      <A href={`/contacts/${c.id}`} class="inline-flex items-center gap-1.5 bg-base-950 border-2 border-base-500 px-2.5 py-1 text-[12px] text-base-50 font-semibold uppercase tracking-wider hover:border-surf-300 hover:shadow-[2px_2px_0_0_var(--color-surf-300)] transition-all">
                        <span>{c.full_name || c.email}</span>
                        <Show when={c.status}>
                          <span class={`text-[10px] leading-none px-1 py-0.5 border ${attendeeStatusClass(c.status)}`}>
                            {ATTENDEE_STATUS_LABEL[c.status] || c.status}
                          </span>
                        </Show>
                      </A>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            <Show when={enrichJobs().length > 0}>
              <div class="panel panel-accent p-5 mb-4">
                <div class="flex items-baseline justify-between gap-2 flex-wrap mb-2">
                  <h3 class="text-[11px] font-bold uppercase tracking-widest text-surf-300">Attendee Research</h3>
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
                          <A href={`/contacts/${j.contactId}`} class="text-sm font-semibold text-base-50 hover:text-surf-300">
                            {j.name}
                          </A>
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
              <h3 class="text-[11px] font-bold uppercase tracking-widest text-surf-300 mb-3">Notes</h3>
              <Show when={m().body} fallback={<span class="text-base-300 text-[13px] italic">No notes yet. Click Edit to add them.</span>}>
                <MarkdownRenderer content={m().body} />
              </Show>
            </div>

            <MeetingFormModal
              open={editOpen()}
              onClose={() => setEditOpen(false)}
              existing={m()}
              fixedAccountId={m().internal ? undefined : m().account_id}
              fixedAccountName={m().internal ? undefined : m().account_name}
              onSaved={() => refetch()}
            />
          </>
        )}
      </Show>
    </div>
  );
}
