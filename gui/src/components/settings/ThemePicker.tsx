// Settings-page section that renders the grid of themes — built-ins,
// then the user's own — with activate / edit / duplicate / delete actions.
// Wraps ThemeEditorModal for the create/edit/duplicate flows.

import { createSignal, For, Show, onMount } from 'solid-js';
import {
  activeTheme,
  themesList,
  refreshThemesList,
  refreshActiveTheme,
  activateTheme,
  type Theme,
} from '../../lib/theme';
import { api } from '../../lib/api';
import ThemeEditorModal from './ThemeEditorModal';

export default function ThemePicker() {
  onMount(() => {
    // Surface any themes the API loaded after mount. ActiveTheme is also
    // refreshed in main.tsx but a second call is cheap and keeps this
    // component self-contained when reused.
    refreshThemesList().catch(() => {});
    refreshActiveTheme().catch(() => {});
  });

  const [editorOpen,    setEditorOpen]    = createSignal(false);
  const [editingTheme,  setEditingTheme]  = createSignal<Theme | null>(null);
  const [busy,          setBusy]          = createSignal(false);
  const [error,         setError]         = createSignal<string | null>(null);

  const activate = async (theme: Theme) => {
    setBusy(true);
    setError(null);
    try {
      await activateTheme(theme.id);
    } catch (err: any) {
      setError(err?.message || 'Failed to activate theme');
    } finally {
      setBusy(false);
    }
  };

  const openEditor = (theme: Theme | null) => {
    setEditingTheme(theme);
    setEditorOpen(true);
  };

  const closeEditor = (didChange: boolean) => {
    setEditorOpen(false);
    setEditingTheme(null);
    if (didChange) {
      refreshThemesList().catch(() => {});
      refreshActiveTheme().catch(() => {});
    } else {
      // Editor was cancelled — make sure the displayed-active theme matches
      // what's actually persisted (the editor's live preview may have
      // diverged momentarily).
      refreshActiveTheme().catch(() => {});
    }
  };

  const deleteTheme = async (theme: Theme) => {
    if (!confirm(`Delete theme "${theme.name}"?\n\nThis cannot be undone. If it's your active theme, you'll fall back to the default built-in.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.deleteTheme(theme.id);
      await refreshThemesList();
      await refreshActiveTheme();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete theme');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div class="panel panel-accent p-5 md:col-span-2">
        <div class="flex flex-col gap-3 mb-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 class="text-[15px] font-bold uppercase tracking-widest text-surf-300 font-[family-name:var(--font-display)]">
              Theme
            </h2>
            <p class="text-base-300 text-[12px] mt-1 max-w-prose">
              Pick a built-in theme or build your own. The active theme applies instantly across the whole app — colors, fonts, and the optional CRT scanline overlay. Your custom themes are stored per-user; built-ins are shared and read-only (use Duplicate to start from one).
            </p>
          </div>
          <button type="button" class="press press-primary press-md self-start" onClick={() => openEditor(null)}>
            + New theme
          </button>
        </div>

        <Show when={error()}>
          <div class="mb-3 p-2 border-2 border-scarlet-500/50 bg-scarlet-500/10 text-scarlet-300 text-[12px]">
            {error()}
          </div>
        </Show>

        <Show
          when={themesList().length > 0}
          fallback={<div class="text-base-300 text-[12px]">Loading themes…</div>}
        >
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <For each={themesList()}>
              {(theme) => (
                <ThemeCard
                  theme={theme}
                  active={activeTheme()?.id === theme.id}
                  busy={busy()}
                  onActivate={() => activate(theme)}
                  onEdit={() => openEditor(theme)}
                  onDelete={() => deleteTheme(theme)}
                />
              )}
            </For>
          </div>
        </Show>
      </div>

      <Show when={editorOpen()}>
        <ThemeEditorModal initial={editingTheme()} onClose={closeEditor} />
      </Show>
    </>
  );
}

function ThemeCard(props: {
  theme: Theme;
  active: boolean;
  busy: boolean;
  onActivate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const swatches = () => {
    const c = props.theme.theme_data?.colors;
    if (!c) return ['#ccc', '#ccc', '#ccc', '#ccc', '#ccc'];
    return [
      c.base?.[10]     ?? '#ccc', // bg
      c.base?.[0]      ?? '#222', // text
      c.surf?.[5]      ?? '#888', // primary
      c.cerulean?.[5]  ?? '#888', // secondary
      c.scarlet?.[5]   ?? '#888', // danger
    ];
  };

  // Inline style scopes the card preview so "Vintage CRT" card actually
  // looks Vintage CRT regardless of what theme is currently active.
  // (We expose just the swatches + body color — typography swap is too
  // heavy for a small card.)
  const cardStyle = () => {
    const data = props.theme.theme_data;
    const bg   = data?.colors?.base?.[9]  ?? 'var(--color-base-900)';
    const text = data?.colors?.base?.[0]  ?? 'var(--color-base-50)';
    const accent = data?.colors?.surf?.[3] ?? 'var(--color-surf-300)';
    return {
      'background-color': bg,
      'color': text,
      'border-color': props.active ? accent : (data?.colors?.base?.[5] ?? 'var(--color-base-500)'),
    } as Record<string, string>;
  };

  return (
    <div
      class="panel p-3 flex flex-col gap-3"
      style={cardStyle()}
    >
      <div class="flex gap-1 h-8">
        <For each={swatches()}>
          {(c) => <div class="flex-1 border border-black/10" style={{ background: c }} />}
        </For>
      </div>
      <div class="min-w-0">
        <div class="font-bold text-[14px] flex items-center gap-2 flex-wrap">
          <span>{props.theme.name}</span>
          <Show when={props.active}>
            <span
              class="text-[9px] uppercase tracking-widest px-1.5 py-0.5 font-bold border-2"
              style={{
                background: props.theme.theme_data?.colors?.surf?.[5] ?? '#3b82f6',
                color: props.theme.theme_data?.colors?.base?.[10] ?? '#fff',
                'border-color': props.theme.theme_data?.colors?.surf?.[2] ?? '#93c5fd',
              }}
            >
              Active
            </span>
          </Show>
        </div>
        <Show when={props.theme.description}>
          <div class="text-[11px] opacity-70 mt-1">{props.theme.description}</div>
        </Show>
        <Show when={props.theme.is_builtin}>
          <div class="text-[10px] opacity-60 uppercase tracking-widest mt-2">Built-in</div>
        </Show>
      </div>
      <div class="flex flex-wrap gap-2 mt-auto pt-1">
        <Show when={!props.active}>
          <button type="button" class="press press-primary press-sm" disabled={props.busy} onClick={props.onActivate}>
            Activate
          </button>
        </Show>
        <Show when={!props.theme.is_builtin}>
          <button type="button" class="press press-ghost press-sm" disabled={props.busy} onClick={props.onEdit}>Edit</button>
          <button type="button" class="press press-danger press-sm" disabled={props.busy} onClick={props.onDelete}>Delete</button>
        </Show>
        <Show when={props.theme.is_builtin}>
          <button type="button" class="press press-ghost press-sm" disabled={props.busy} onClick={props.onEdit}>Duplicate</button>
        </Show>
      </div>
    </div>
  );
}
