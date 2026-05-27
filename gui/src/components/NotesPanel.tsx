import { createResource, createSignal, For, Show } from 'solid-js';
import { api } from '../lib/api';
import Button from './Button';
import MarkdownRenderer from './MarkdownRenderer';

type Target =
  | { account_id: number }
  | { contact_id: number }
  | { opportunity_id: number };

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function NotesPanel(props: { target: Target; inlineCompose?: boolean }) {
  const [feed, { refetch }] = createResource(
    () => props.target,
    (target) => api.getNotes({ ...target, limit: 500 })
  );

  const [composing, setComposing] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const [editingId, setEditingId] = createSignal<number | null>(null);
  const [editingBody, setEditingBody] = createSignal('');

  // API returns notes newest-first; inline mode wants chronological (oldest at
  // top, newest at bottom, right above the always-on compose box).
  const orderedNotes = () => {
    const notes = feed()?.notes || [];
    return props.inlineCompose ? [...notes].reverse() : notes;
  };

  const submitNew = async () => {
    const body = draft().trim();
    if (!body) {
      if (!props.inlineCompose) {
        setComposing(false);
        setDraft('');
      }
      return;
    }
    await api.createNote({ ...props.target, body });
    setDraft('');
    if (!props.inlineCompose) setComposing(false);
    refetch();
  };

  const startEdit = (note: any) => {
    setEditingId(note.id);
    setEditingBody(note.body || '');
  };

  const saveEdit = async () => {
    const id = editingId();
    if (id == null) return;
    await api.patchNote(id, { body: editingBody() });
    setEditingId(null);
    setEditingBody('');
    refetch();
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingBody('');
  };

  const removeNote = async (id: number) => {
    if (!confirm('Delete this note?')) return;
    await api.deleteNote(id);
    refetch();
  };

  return (
    <div>
      <div class="mb-4 flex items-center justify-between gap-2 flex-wrap">
        <h3 class="text-[13px] font-bold uppercase tracking-widest text-surf-300 font-[family-name:var(--font-display)]">Notes</h3>
        <Show when={!props.inlineCompose && !composing()}>
          <Button variant="primary" size="sm" onClick={() => { setComposing(true); setDraft(''); }}>+ New Note</Button>
        </Show>
      </div>

      <Show when={!props.inlineCompose && composing()}>
        <div class="panel panel-accent p-4 mb-4 flex flex-col gap-3">
          <textarea
            class="input-vintage font-mono text-[12px] leading-relaxed"
            rows={6}
            placeholder="Markdown supported. Each note is timestamped on save."
            value={draft()}
            onInput={(e) => setDraft(e.currentTarget.value)}
            autofocus
          />
          <div class="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => { setComposing(false); setDraft(''); }}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={submitNew} disabled={!draft().trim()}>Save Note</Button>
          </div>
        </div>
      </Show>

      <Show
        when={!feed.loading}
        fallback={<div class="text-base-300 text-center p-10 text-sm">Loading notes...</div>}
      >
        <div class="flex flex-col gap-3">
          <For
            each={orderedNotes()}
            fallback={
              <Show when={!composing() && !props.inlineCompose}>
                <div class="text-base-300 text-center p-10 text-sm italic">No notes yet. Click + New Note to capture a timestamped observation.</div>
              </Show>
            }
          >
            {(note: any) => (
              <div class="panel panel-accent p-4">
                <div class="flex items-center justify-between gap-3 flex-wrap mb-2">
                  <div class="text-[11px] uppercase tracking-widest text-base-300 font-mono">
                    {formatTimestamp(note.created_at)}
                    <Show when={note.updated_at && note.updated_at !== note.created_at}>
                      <span class="ml-2 text-base-400">(edited {formatTimestamp(note.updated_at)})</span>
                    </Show>
                  </div>
                  <Show when={editingId() !== note.id}>
                    <div class="flex gap-2">
                      <button
                        type="button"
                        class="press press-ghost press-sm"
                        onClick={() => startEdit(note)}
                      >
                        Edit
                      </button>
                      <button class="btn-x" onClick={() => removeNote(note.id)} title="Delete note">×</button>
                    </div>
                  </Show>
                </div>
                <Show
                  when={editingId() === note.id}
                  fallback={
                    <Show when={note.body} fallback={<span class="text-base-400 text-[13px] italic">(empty)</span>}>
                      <MarkdownRenderer content={note.body} />
                    </Show>
                  }
                >
                  <div class="flex flex-col gap-3">
                    <textarea
                      class="input-vintage font-mono text-[12px] leading-relaxed"
                      rows={6}
                      value={editingBody()}
                      onInput={(e) => setEditingBody(e.currentTarget.value)}
                    />
                    <div class="flex gap-2 justify-end">
                      <Button variant="ghost" size="sm" onClick={cancelEdit}>Cancel</Button>
                      <Button variant="primary" size="sm" onClick={saveEdit}>Save</Button>
                    </div>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={props.inlineCompose}>
        <div class="panel panel-accent p-4 mt-3 flex flex-col gap-2">
          <textarea
            class="input-vintage font-mono text-[12px] leading-relaxed"
            rows={4}
            placeholder="Type a note… (markdown supported, timestamped on save)"
            value={draft()}
            onInput={(e) => setDraft(e.currentTarget.value)}
          />
          <div class="flex justify-end">
            <Button variant="primary" size="sm" onClick={submitNew} disabled={!draft().trim()}>Add</Button>
          </div>
        </div>
      </Show>
    </div>
  );
}
