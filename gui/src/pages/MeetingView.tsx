import { createResource, createSignal, createEffect, onCleanup, Show, For } from 'solid-js';
import { A, useParams, useNavigate } from '@solidjs/router';
import { api } from '../lib/api';
import MarkdownRenderer from '../components/MarkdownRenderer';
import { MeetingFormModal } from '../components/FormModals';
import AccountPicker from '../components/AccountPicker';
import Button from '../components/Button';
import BackLink from '../components/BackLink';
import ExportActions from '../components/ExportActions';
import { buildMeetingsExport } from '../lib/meetingExport';
import { attendeeStatusClass, attendeeStatusLabel } from '../lib/attendeeStatus';

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

export default function MeetingView() {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [meeting, { refetch }] = createResource(() => Number(params.id), (id) => api.getMeeting(id));
  const [editOpen, setEditOpen] = createSignal(false);

  // Triage panel state (needs_review). The panel takes one of two shapes
  // depending on whether the note already has an account:
  //   • account-less (agent-parked note): pick an account to assign, or confirm
  //     it's internal — assignTarget/assignAccount drive this.
  //   • already on an auto-created account (calendar import flagged it for
  //     confirmation): confirm that account or move it. assign-account would 409
  //     here since the note is already linked, so we never offer it.
  // assigning/assignError are shared by both shapes (busy state + error line).
  const [assignTarget, setAssignTarget] = createSignal<{ id: number; name: string; slug: string } | null>(null);
  const [assigning, setAssigning] = createSignal(false);
  const [assignError, setAssignError] = createSignal('');

  // Move/reassign panel state — for a meeting that's ALREADY on an account (or
  // internal) but landed on the wrong one (bad import): move it to another
  // account, or strip the account and make it internal. Distinct from the
  // parked-note triage above, which only assigns account-less notes.
  const [moveOpen, setMoveOpen] = createSignal(false);
  const [moveTarget, setMoveTarget] = createSignal<{ id: number; name: string; slug: string } | null>(null);
  const [moving, setMoving] = createSignal(false);
  const [moveError, setMoveError] = createSignal('');

  const assignAccount = async () => {
    const m = meeting();
    const target = assignTarget();
    if (!m || !target) return;
    setAssigning(true);
    setAssignError('');
    try {
      await api.assignMeetingAccount(m.id, target.id);
      setAssignTarget(null);
      refetch();
    } catch (err: any) {
      setAssignError(err?.message || 'Failed to assign account');
    } finally {
      setAssigning(false);
    }
  };

  // Dismiss the needs_review flag without changing the account or internal
  // state. Used both to confirm an auto-created account is correct and to keep
  // an account-less note as internal — both just settle the triage question.
  const clearReview = async () => {
    const m = meeting();
    if (!m) return;
    setAssigning(true);
    setAssignError('');
    try {
      await api.updateMeeting(m.id, { needs_review: false });
      refetch();
    } catch (err: any) {
      setAssignError(err?.message || 'Failed to update note');
    } finally {
      setAssigning(false);
    }
  };

  // Move the meeting to a different account (works even when it already has
  // one). Attendees stay attached — who was in the room is independent of the
  // account.
  const moveToAccount = async () => {
    const m = meeting();
    const target = moveTarget();
    if (!m || !target) return;
    setMoving(true);
    setMoveError('');
    try {
      await api.reassignMeetingAccount(m.id, { account_id: target.id });
      setMoveOpen(false);
      setMoveTarget(null);
      refetch();
    } catch (err: any) {
      setMoveError(err?.message || 'Failed to move meeting');
    } finally {
      setMoving(false);
    }
  };

  // Strip the account and convert the meeting to an account-less internal note
  // (e.g. an internal note that got mis-imported onto an account).
  const makeInternal = async () => {
    const m = meeting();
    if (!m) return;
    if (!confirm('Convert this meeting to an internal note (remove its account)?')) return;
    setMoving(true);
    setMoveError('');
    try {
      await api.reassignMeetingAccount(m.id, { internal: true });
      setMoveOpen(false);
      setMoveTarget(null);
      refetch();
    } catch (err: any) {
      setMoveError(err?.message || 'Failed to convert meeting');
    } finally {
      setMoving(false);
    }
  };

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
                <Button variant="ghost" size="sm" onClick={() => { setMoveOpen((v) => !v); setMoveError(''); }}>Move</Button>
                <Button variant="ghost" size="sm" onClick={() => setEditOpen(true)}>Edit</Button>
                <Button variant="danger" size="sm" onClick={deleteMeeting}>Delete</Button>
              </div>
            </div>

            <Show when={m().needs_review}>
              <div class="panel p-5 mb-4 border-2 border-amber-300 bg-amber-300/5">
                <div class="flex items-center gap-2 mb-2">
                  <span class="bg-base-950 border-2 border-amber-300 text-amber-300 text-[10px] px-1.5 py-0.5 uppercase tracking-widest font-bold leading-none">Needs review</span>
                </div>

                <Show
                  when={m().account_id}
                  fallback={
                    // Account-less parked note: genuinely unassigned, so assigning
                    // is the right action (the importer/agent couldn't place it).
                    <>
                      <h3 class="text-[14px] font-bold text-base-50 mb-1">This note isn't assigned to an account.</h3>
                      <p class="text-base-300 text-[12px] mb-3">
                        The importer couldn't confidently place it. Assign the account it belongs to, or confirm it's an internal note and dismiss the flag.
                      </p>
                      <div class="flex flex-col gap-2 md:flex-row md:items-center">
                        <div class="flex-1 min-w-0">
                          <AccountPicker value={assignTarget()} onChange={setAssignTarget} placeholder="Search for an account..." />
                        </div>
                        <Button variant="primary" size="sm" disabled={!assignTarget() || assigning()} onClick={assignAccount}>
                          {assigning() ? 'Assigning…' : 'Assign account'}
                        </Button>
                        <Button variant="ghost" size="sm" disabled={assigning()} onClick={clearReview}>
                          Keep as internal
                        </Button>
                      </div>
                    </>
                  }
                >
                  {/* Already linked to an auto-created account (calendar import). It's
                      NOT unassigned — offer Confirm (clear the flag) or Move (reassign),
                      never Assign, which would 409 against an already-linked note. */}
                  <h3 class="text-[14px] font-bold text-base-50 mb-1">
                    Auto-created account: <span class="text-amber-300">{m().account_name}</span>
                  </h3>
                  <p class="text-base-300 text-[12px] mb-3">
                    The importer created this account from the attendees' email domain and linked the note to it. Confirm it's the right account, or move it to a different one.
                  </p>
                  <div class="flex flex-col gap-2 md:flex-row md:items-center">
                    <Button variant="primary" size="sm" disabled={assigning()} onClick={clearReview}>
                      {assigning() ? 'Confirming…' : 'Confirm account'}
                    </Button>
                    <Button variant="ghost" size="sm" disabled={assigning()} onClick={() => { setMoveOpen(true); setMoveError(''); }}>
                      Move to a different account
                    </Button>
                  </div>
                </Show>

                <Show when={assignError()}>
                  <div class="text-[11px] text-scarlet-400 mt-2 font-semibold">{assignError()}</div>
                </Show>
              </div>
            </Show>

            <Show when={moveOpen()}>
              <div class="panel p-5 mb-4 border-2 border-surf-300 bg-surf-300/5">
                <h3 class="text-[14px] font-bold text-base-50 mb-1">Move this meeting</h3>
                <p class="text-base-300 text-[12px] mb-3">
                  Reassign this note to a different account{!m().internal ? ', or strip the account and make it an internal note' : ''}. Attendees stay attached.
                </p>
                <div class="flex flex-col gap-2 md:flex-row md:items-center">
                  <div class="flex-1 min-w-0">
                    <AccountPicker value={moveTarget()} onChange={setMoveTarget} placeholder="Move to account..." />
                  </div>
                  <Button variant="primary" size="sm" disabled={!moveTarget() || moving()} onClick={moveToAccount}>
                    {moving() ? 'Moving…' : 'Move here'}
                  </Button>
                  <Show when={!m().internal}>
                    <Button variant="ghost" size="sm" disabled={moving()} onClick={makeInternal}>
                      Make internal
                    </Button>
                  </Show>
                </div>
                <Show when={moveError()}>
                  <div class="text-[11px] text-scarlet-400 mt-2 font-semibold">{moveError()}</div>
                </Show>
              </div>
            </Show>

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
                            {attendeeStatusLabel(c.status)}
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
