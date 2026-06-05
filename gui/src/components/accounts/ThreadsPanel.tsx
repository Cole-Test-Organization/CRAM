import { createResource, createSignal, For, Show } from 'solid-js';
import { api } from '../../lib/api';
import type { Thread, ThreadTask, ThreadContact } from '../../lib/types';
import Button from '../Button';

// Threads + tasks for one account. Self-contained (owns its own fetch + CRUD,
// like NotesPanel). Open threads only by default; "show closed" reveals the
// history. The contact pool on each thread is exactly the option set for that
// thread's task assignees — so adding someone to "People" lets you assign them.

function fmtDue(d: string | null): string {
  if (!d) return '';
  const [y, m, day] = d.split('-').map(Number);
  if (!y) return d;
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function isOverdue(due: string | null, completed: string | null): boolean {
  if (!due || completed) return false;
  return due < new Date().toISOString().slice(0, 10);
}

const label = (c: ThreadContact) => c.full_name || c.email || `#${c.id}`;

export default function ThreadsPanel(props: {
  accountId: number;
  accountContacts: ThreadContact[];
  onThreadsChanged?: () => void;
}) {
  const [includeClosed, setIncludeClosed] = createSignal(false);
  const [data, { refetch }] = createResource(
    () => ({ id: props.accountId, closed: includeClosed() }),
    ({ id, closed }) => api.getThreads(id, closed),
  );
  const threads = () => data()?.threads || [];

  const reload = () => refetch();
  // Thread create/close/reopen/delete change the open-thread count → also poke
  // the parent so the tab badge stays accurate. Task/pool/title edits don't.
  const reloadAndNotify = async () => { await refetch(); props.onThreadsChanged?.(); };

  // ── new thread composer ───────────────────────────────────────────────────
  const [composing, setComposing] = createSignal(false);
  const [newTitle, setNewTitle] = createSignal('');
  const [newDesc, setNewDesc] = createSignal('');
  const createThread = async () => {
    const title = newTitle().trim();
    if (!title) return;
    await api.createThread({ account_id: props.accountId, title, description: newDesc().trim() || null });
    setNewTitle(''); setNewDesc(''); setComposing(false);
    reloadAndNotify();
  };

  // ── inline edits: thread title / description ──────────────────────────────
  const [editTitleId, setEditTitleId] = createSignal<number | null>(null);
  const [titleDraft, setTitleDraft] = createSignal('');
  const saveTitle = async (t: Thread) => {
    setEditTitleId(null);
    const v = titleDraft().trim();
    if (v && v !== t.title) { await api.patchThread(t.id, { title: v }); reload(); }
  };
  const [editDescId, setEditDescId] = createSignal<number | null>(null);
  const [descDraft, setDescDraft] = createSignal('');
  const saveDesc = async (t: Thread) => {
    setEditDescId(null);
    const v = descDraft();
    if (v !== (t.description || '')) { await api.patchThread(t.id, { description: v || null }); reload(); }
  };

  const toggleClosed = async (t: Thread) => {
    await api.patchThread(t.id, { closed: !t.closed_at });
    reloadAndNotify();
  };
  const removeThread = async (t: Thread) => {
    if (!confirm(`Delete thread "${t.title}" and all its tasks? Closing it instead keeps the history.`)) return;
    await api.deleteThread(t.id);
    reloadAndNotify();
  };

  // ── tasks ─────────────────────────────────────────────────────────────────
  const [addingTaskFor, setAddingTaskFor] = createSignal<number | null>(null);
  const [taskTitle, setTaskTitle] = createSignal('');
  const addTask = async (threadId: number) => {
    const title = taskTitle().trim();
    setAddingTaskFor(null);
    if (!title) return;
    setTaskTitle('');
    await api.addThreadTask(threadId, { title });
    reload();
  };
  const [editTaskId, setEditTaskId] = createSignal<number | null>(null);
  const [taskDraft, setTaskDraft] = createSignal('');
  const saveTask = async (threadId: number, task: ThreadTask) => {
    setEditTaskId(null);
    const v = taskDraft().trim();
    if (v && v !== task.title) { await api.patchThreadTask(threadId, task.id, { title: v }); reload(); }
  };
  const toggleTask = async (threadId: number, task: ThreadTask) => {
    await api.patchThreadTask(threadId, task.id, { completed: !task.completed_at });
    reload();
  };
  const setAssignee = async (threadId: number, task: ThreadTask, val: string) => {
    await api.patchThreadTask(threadId, task.id, { assignee_contact_id: val ? Number(val) : null });
    reload();
  };
  const setDue = async (threadId: number, task: ThreadTask, val: string) => {
    await api.patchThreadTask(threadId, task.id, { due_date: val || null });
    reload();
  };
  const removeTask = async (threadId: number, task: ThreadTask) => {
    await api.deleteThreadTask(threadId, task.id);
    reload();
  };

  // ── contact pool ──────────────────────────────────────────────────────────
  const addToPool = async (threadId: number, contactId: number) => {
    if (!contactId) return;
    await api.linkThreadContact(threadId, contactId);
    reload();
  };
  const removeFromPool = async (threadId: number, contactId: number) => {
    await api.unlinkThreadContact(threadId, contactId);
    reload();
  };
  const poolCandidates = (t: Thread) => {
    const inPool = new Set(t.contacts.map((c) => c.id));
    return (props.accountContacts || []).filter((c) => !inPool.has(c.id));
  };

  return (
    <div>
      <div class="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h3 class="text-[13px] font-bold uppercase tracking-widest text-surf-300 font-[family-name:var(--font-display)]">Threads</h3>
        <div class="flex items-center gap-3 flex-wrap">
          <label class="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-base-300 cursor-pointer select-none">
            <input type="checkbox" checked={includeClosed()} onChange={(e) => setIncludeClosed(e.currentTarget.checked)} />
            show closed
          </label>
          <Show when={!composing()}>
            <Button variant="primary" size="sm" onClick={() => { setComposing(true); setNewTitle(''); setNewDesc(''); }}>+ New Thread</Button>
          </Show>
        </div>
      </div>

      <Show when={composing()}>
        <div class="panel panel-accent p-4 mb-4 flex flex-col gap-3">
          <input
            class="input-vintage font-bold"
            placeholder="Thread title — e.g. Firewall refresh POV"
            value={newTitle()}
            onInput={(e) => setNewTitle(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') createThread(); }}
            autofocus
          />
          <textarea
            class="input-vintage text-[12px]"
            rows={2}
            placeholder="Optional description / context"
            value={newDesc()}
            onInput={(e) => setNewDesc(e.currentTarget.value)}
          />
          <div class="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => { setComposing(false); setNewTitle(''); setNewDesc(''); }}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={createThread} disabled={!newTitle().trim()}>Create Thread</Button>
          </div>
        </div>
      </Show>

      <Show when={!data.loading} fallback={<div class="text-base-300 text-center p-10 text-sm">Loading threads...</div>}>
        <div class="flex flex-col gap-3">
          <For each={threads()} fallback={
            <Show when={!composing()}>
              <div class="text-base-300 text-center p-10 text-sm italic">
                {includeClosed() ? 'No threads on this account yet.' : 'No open threads. Click + New Thread to start tracking a workstream on this account.'}
              </div>
            </Show>
          }>
            {(t) => (
              <div class={`panel panel-accent p-4 ${t.closed_at ? 'opacity-60' : ''}`}>
                {/* title + lifecycle */}
                <div class="flex items-start justify-between gap-3 flex-wrap">
                  <div class="flex-1 min-w-0">
                    <Show
                      when={editTitleId() === t.id}
                      fallback={
                        <div class="flex items-center gap-2 flex-wrap">
                          <span
                            class="text-[15px] font-bold cursor-pointer font-[family-name:var(--font-display)]"
                            onClick={() => { setEditTitleId(t.id); setTitleDraft(t.title); }}
                            title="Click to edit"
                          >{t.title}</span>
                          <Show when={t.closed_at}>
                            <span class="text-[10px] uppercase tracking-widest text-base-400 border border-base-600 px-1.5 py-0.5">closed</span>
                          </Show>
                        </div>
                      }
                    >
                      <input
                        class="press-field text-[15px] font-bold w-full"
                        value={titleDraft()}
                        onInput={(e) => setTitleDraft(e.currentTarget.value)}
                        onBlur={() => saveTitle(t)}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditTitleId(null); }}
                        autofocus
                      />
                    </Show>
                  </div>
                  <div class="flex gap-2 items-center shrink-0">
                    <button type="button" class="press press-ghost press-sm" onClick={() => toggleClosed(t)}>{t.closed_at ? 'Reopen' : 'Close'}</button>
                    <button class="btn-x" onClick={() => removeThread(t)} title="Delete thread">×</button>
                  </div>
                </div>

                {/* description */}
                <div class="mt-1 mb-3">
                  <Show
                    when={editDescId() === t.id}
                    fallback={
                      <Show
                        when={t.description}
                        fallback={<span class="text-[12px] text-base-400 italic cursor-pointer" onClick={() => { setEditDescId(t.id); setDescDraft(''); }}>+ add description</span>}
                      >
                        <span
                          class="text-[12px] text-base-200 cursor-pointer whitespace-pre-wrap"
                          onClick={() => { setEditDescId(t.id); setDescDraft(t.description || ''); }}
                          title="Click to edit"
                        >{t.description}</span>
                      </Show>
                    }
                  >
                    <textarea
                      class="input-vintage text-[12px] w-full"
                      rows={2}
                      value={descDraft()}
                      onInput={(e) => setDescDraft(e.currentTarget.value)}
                      onBlur={() => saveDesc(t)}
                      autofocus
                    />
                  </Show>
                </div>

                {/* tasks */}
                <div class="flex flex-col gap-1.5">
                  <For each={t.tasks}>
                    {(task) => (
                      <div class="flex items-center gap-2 flex-wrap text-[12px] border-t border-base-700 pt-1.5">
                        <input type="checkbox" checked={!!task.completed_at} onChange={() => toggleTask(t.id, task)} title={task.completed_at ? 'Mark not done' : 'Mark done'} />
                        <Show
                          when={editTaskId() === task.id}
                          fallback={
                            <span
                              class={`flex-1 min-w-[8rem] cursor-pointer ${task.completed_at ? 'line-through text-base-400' : ''}`}
                              onClick={() => { setEditTaskId(task.id); setTaskDraft(task.title); }}
                              title="Click to edit"
                            >{task.title}</span>
                          }
                        >
                          <input
                            class="press-field flex-1 min-w-[8rem]"
                            value={taskDraft()}
                            onInput={(e) => setTaskDraft(e.currentTarget.value)}
                            onBlur={() => saveTask(t.id, task)}
                            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditTaskId(null); }}
                            autofocus
                          />
                        </Show>
                        <select
                          class="press-field text-[11px]"
                          value={task.assignee_contact_id != null ? String(task.assignee_contact_id) : ''}
                          onChange={(e) => setAssignee(t.id, task, e.currentTarget.value)}
                          title="Assignee"
                        >
                          <option value="">(No One)</option>
                          <For each={t.contacts}>{(c) => <option value={String(c.id)}>{label(c)}</option>}</For>
                          <Show when={task.assignee_contact_id != null && !t.contacts.some((c) => c.id === task.assignee_contact_id)}>
                            <option value={String(task.assignee_contact_id)}>{task.assignee_full_name || `#${task.assignee_contact_id}`}</option>
                          </Show>
                        </select>
                        <input
                          type="date"
                          class={`press-field text-[11px] ${isOverdue(task.due_date, task.completed_at) ? 'text-red-400' : ''}`}
                          value={task.due_date || ''}
                          onChange={(e) => setDue(t.id, task, e.currentTarget.value)}
                          title={isOverdue(task.due_date, task.completed_at) ? `Overdue (${fmtDue(task.due_date)})` : 'Due date'}
                        />
                        <button class="btn-x" onClick={() => removeTask(t.id, task)} title="Delete task">×</button>
                      </div>
                    )}
                  </For>

                  <Show
                    when={addingTaskFor() === t.id}
                    fallback={<button type="button" class="text-[11px] text-surf-300 hover:text-surf-200 self-start mt-1 cursor-pointer" onClick={() => { setAddingTaskFor(t.id); setTaskTitle(''); }}>+ add task</button>}
                  >
                    <input
                      class="press-field flex-1 text-[12px] mt-1"
                      placeholder="Task — e.g. Send updated SOW"
                      value={taskTitle()}
                      onInput={(e) => setTaskTitle(e.currentTarget.value)}
                      onBlur={() => addTask(t.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setAddingTaskFor(null); setTaskTitle(''); } }}
                      autofocus
                    />
                  </Show>
                </div>

                {/* contact pool (= assignee options) */}
                <div class="flex items-center gap-2 flex-wrap mt-3 pt-2 border-t border-base-700">
                  <span class="text-[10px] uppercase tracking-widest text-base-400">People</span>
                  <For each={t.contacts} fallback={<span class="text-[11px] text-base-500 italic">none yet</span>}>
                    {(c) => (
                      <span class="inline-flex items-center gap-1 text-[11px] border border-base-600 px-1.5 py-0.5">
                        {label(c)}
                        <button class="btn-x" onClick={() => removeFromPool(t.id, c.id)} title="Remove from pool">×</button>
                      </span>
                    )}
                  </For>
                  <Show when={poolCandidates(t).length > 0}>
                    <select
                      class="press-field text-[11px]"
                      value=""
                      onChange={(e) => { const v = e.currentTarget.value; e.currentTarget.value = ''; if (v) addToPool(t.id, Number(v)); }}
                    >
                      <option value="">+ add person</option>
                      <For each={poolCandidates(t)}>{(c) => <option value={String(c.id)}>{label(c)}</option>}</For>
                    </select>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
