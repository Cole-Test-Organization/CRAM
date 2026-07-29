import {
  createEffect,
  createResource,
  createSignal,
  onCleanup,
  Show,
} from 'solid-js';
import { useParams, useSearchParams } from '@solidjs/router';
import { api } from '../lib/api';
import { isOffline } from '../lib/offline';
import {
  clearMeetingDraft,
  loadMeetingDraft,
  saveMeetingDraft,
} from '../lib/meetingDraft';

const AUTOSAVE_DELAY_MS = 900;
const NOTES_CHANNEL = 'cram-meeting-notes';

type SavePhase = 'loading' | 'local' | 'saving' | 'saved';

type FloatingMeetingNotesEditorProps = {
  meetingId: number;
  fallbackTitle?: string;
  fallbackAccount?: string;
  fallbackStartsAt?: string;
};

function formatMeetingTime(value?: string | null) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function FloatingMeetingNotesEditor(props: FloatingMeetingNotesEditorProps) {
  const initialDraft = loadMeetingDraft(props.meetingId);
  const [meeting, { mutate, refetch }] = createResource(
    () => props.meetingId,
    (meetingId) => api.getMeeting(meetingId),
  );
  const [body, setBody] = createSignal(initialDraft?.body || '');
  const [phase, setPhase] = createSignal<SavePhase>(initialDraft ? 'local' : 'loading');
  const [saveError, setSaveError] = createSignal('');
  const [lastSavedAt, setLastSavedAt] = createSignal<string | null>(null);
  let baseUpdatedAt = initialDraft?.baseUpdatedAt || null;
  let userEdited = Boolean(initialDraft);
  let initializedFromServer = false;
  let autosaveTimer: number | undefined;
  const channel = typeof BroadcastChannel === 'undefined'
    ? null
    : new BroadcastChannel(NOTES_CHANNEL);

  createEffect(() => {
    const value = meeting();
    if (!value) return;
    if (!initializedFromServer) {
      initializedFromServer = true;
      baseUpdatedAt = initialDraft?.baseUpdatedAt || value.updated_at || null;
      if (!userEdited) setBody(value.body || '');
    } else if (!userEdited) {
      setBody(value.body || '');
      baseUpdatedAt = value.updated_at || baseUpdatedAt;
    }
    if (!userEdited) setPhase('saved');
  });

  createEffect(() => {
    const title = meeting()?.title
      || meeting()?.filename
      || props.fallbackTitle
      || `Meeting ${props.meetingId}`;
    document.title = `${title} — Notes`;
  });

  onCleanup(() => {
    if (autosaveTimer !== undefined) window.clearTimeout(autosaveTimer);
    channel?.close();
  });

  const title = () =>
    meeting()?.title
    || meeting()?.filename
    || props.fallbackTitle
    || `Meeting ${props.meetingId}`;
  const account = () => meeting()?.account_name || props.fallbackAccount || '';
  const startsAt = () => meeting()?.starts_at || props.fallbackStartsAt || '';
  const statusCopy = () => {
    if (phase() === 'loading') return 'Loading meeting…';
    if (phase() === 'saving') return 'Saving to CRAM…';
    if (phase() === 'local') {
      return isOffline()
        ? 'Saved locally · CRAM is offline'
        : 'Saved locally · not yet synced';
    }
    if (lastSavedAt()) {
      return `Saved to CRAM at ${new Date(lastSavedAt()!).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      })}`;
    }
    return 'Saved to CRAM';
  };

  const persistToServer = async () => {
    const currentMeeting = meeting();
    if (!currentMeeting || phase() === 'saving' || !body().trim()) return;
    if (autosaveTimer !== undefined) window.clearTimeout(autosaveTimer);
    autosaveTimer = undefined;

    const snapshot = body();
    setPhase('saving');
    setSaveError('');
    try {
      const updated = await api.updateMeeting(props.meetingId, { body: snapshot });
      baseUpdatedAt = updated.updated_at || baseUpdatedAt;
      mutate({ ...currentMeeting, ...updated });
      channel?.postMessage({ meetingId: props.meetingId });

      if (body() === snapshot) {
        clearMeetingDraft(props.meetingId);
        userEdited = false;
        setPhase('saved');
        setLastSavedAt(new Date().toISOString());
      } else {
        saveMeetingDraft(props.meetingId, body(), baseUpdatedAt);
        setPhase('local');
        if (!isOffline()) {
          autosaveTimer = window.setTimeout(() => void persistToServer(), AUTOSAVE_DELAY_MS);
        }
      }
    } catch (error: any) {
      // The draft was written synchronously on every keystroke before this
      // network attempt. A failed save therefore never discards meeting notes.
      setPhase('local');
      setSaveError(error?.message || 'Could not reach CRAM. This draft remains local.');
    }
  };

  const updateBody = (value: string) => {
    userEdited = true;
    setBody(value);
    saveMeetingDraft(props.meetingId, value, baseUpdatedAt);
    setPhase('local');
    setSaveError('');

    if (autosaveTimer !== undefined) window.clearTimeout(autosaveTimer);
    if (meeting() && !isOffline()) {
      autosaveTimer = window.setTimeout(() => void persistToServer(), AUTOSAVE_DELAY_MS);
    }
  };

  return (
    <div class="h-screen min-h-[420px] bg-base-950 text-base-50 p-4 flex flex-col overflow-hidden">
      <header class="border-2 border-base-500 bg-base-900 shadow-[3px_3px_0_0_var(--color-surf-300)] p-3 mb-3 shrink-0">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="text-[10px] uppercase tracking-[0.18em] text-surf-300 font-bold mb-1">
              Floating meeting notes
            </div>
            <h1 class="font-[family-name:var(--font-display)] font-bold text-[17px] leading-tight break-words">
              {title()}
            </h1>
            <div class="text-[11px] text-base-300 mt-1 flex gap-2 flex-wrap">
              <Show when={formatMeetingTime(startsAt())}>
                <span>{formatMeetingTime(startsAt())}</span>
              </Show>
              <Show when={account()}>
                <span>· {account()}</span>
              </Show>
            </div>
          </div>
          <span class="border-2 border-surf-300 text-surf-300 px-2 py-1 text-[9px] uppercase tracking-widest font-bold shrink-0">
            Always on top
          </span>
        </div>
      </header>

      <textarea
        aria-label="Meeting notes"
        autofocus
        spellcheck
        value={body()}
        onInput={(event) => updateBody(event.currentTarget.value)}
        placeholder="Start taking notes… Markdown is supported."
        class="flex-1 min-h-0 resize-none bg-base-900 border-2 border-base-500 text-base-50 p-3 font-mono text-[14px] leading-relaxed outline-none focus:border-surf-300 focus:shadow-[3px_3px_0_0_var(--color-surf-300)] placeholder:text-base-500"
      />

      <footer class="pt-3 shrink-0">
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div class="min-w-0">
            <div
              role="status"
              class={`text-[10px] uppercase tracking-wider font-semibold ${
                phase() === 'local' ? 'text-amber-300' : 'text-base-300'
              }`}
            >
              {statusCopy()}
            </div>
            <Show when={saveError()}>
              <div class="text-[10px] text-scarlet-400 mt-1 max-w-[280px]">
                {saveError()}
              </div>
            </Show>
            <Show when={meeting.error}>
              <div class="text-[10px] text-amber-300 mt-1 max-w-[280px]">
                Meeting details are unavailable. You can keep writing locally, then retry when connected.
              </div>
            </Show>
          </div>
          <div class="flex gap-2">
            <Show when={meeting.error}>
              <button
                type="button"
                class="press press-ghost press-sm"
                onClick={() => void refetch()}
              >
                Retry load
              </button>
            </Show>
            <button
              type="button"
              class="press press-primary press-sm"
              disabled={!meeting() || phase() === 'saving' || phase() === 'saved' || !body().trim()}
              onClick={() => void persistToServer()}
            >
              {phase() === 'saving' ? 'Saving…' : 'Save to CRAM'}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default function FloatingMeetingNotes() {
  const params = useParams<{ id: string }>();
  const [search] = useSearchParams<{
    title?: string;
    account?: string;
    startsAt?: string;
  }>();
  return (
    <FloatingMeetingNotesEditor
      meetingId={Number(params.id)}
      fallbackTitle={search.title}
      fallbackAccount={search.account}
      fallbackStartsAt={search.startsAt}
    />
  );
}
