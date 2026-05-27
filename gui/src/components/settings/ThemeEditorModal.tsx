// Theme editor — used for both creating new themes and editing the caller's
// own existing themes. Built-in themes can't be edited directly; the "Edit"
// button on a built-in card opens this modal in "duplicate" mode (preserves
// the user's customisation by creating a new theme from the built-in's data).
//
// Live preview: every change applies to the whole document via
// previewThemeData (no localStorage write — the cached active theme is
// preserved). Cancel re-applies the snapshot captured at modal open. Save
// persists and activates the result so what the user sees is what they get.

import { createSignal, createEffect, Show } from 'solid-js';
import Modal from '../Modal';
import {
  activeTheme,
  applyThemeData,
  buildThemeData,
  keyColorsFromTheme,
  previewThemeData,
  refreshThemesList,
  activateTheme,
  type Theme,
  type ThemeData,
  type ThemeFonts,
  type ThemeEffects,
  type KeyColors,
} from '../../lib/theme';
import { api } from '../../lib/api';

const FONT_PRESETS = {
  sans:    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  serif:   "Georgia, 'Iowan Old Style', 'Times New Roman', Cambria, serif",
  mono:    "ui-monospace, 'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace",
  display: "'Crimson Text', 'Iowan Old Style', Georgia, 'Times New Roman', serif",
};

const FALLBACK_KEY_COLORS: KeyColors = {
  primary:    '#3b82f6',
  secondary:  '#64748b',
  accent:     '#0d9488',
  warning:    '#eab308',
  danger:     '#dc2626',
  text:       '#1a1a1a',
  background: '#ffffff',
};

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'custom-theme';
}

// HTML <input type="color"> only accepts #rrggbb. Normalize 3-char shorthand
// and tolerate empty/invalid values without erroring.
function normalizeForPicker(hex: string): string {
  const h = hex.trim().replace('#', '');
  if (h.length === 3) return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
  if (h.length === 6 && /^[0-9a-fA-F]{6}$/.test(h)) return `#${h.toLowerCase()}`;
  return '#000000';
}

export default function ThemeEditorModal(props: {
  initial: Theme | null;
  onClose: (refresh: boolean) => void;
}) {
  // Snapshot the active theme so cancel can restore it visually.
  const snapshot: ThemeData | null = activeTheme()?.theme_data ?? null;

  const isEditing     = props.initial !== null && !props.initial.is_builtin;
  const isDuplicating = props.initial !== null &&  props.initial.is_builtin;

  // Starting data: prefer the row being edited/duplicated; else the currently
  // active theme; else the bland fallback. This way "new theme" doesn't
  // immediately blank-slate the user's app on open.
  const startingTheme: ThemeData =
    props.initial?.theme_data ?? activeTheme()?.theme_data ?? null as any;

  const startingKey: KeyColors = startingTheme
    ? keyColorsFromTheme(startingTheme)
    : FALLBACK_KEY_COLORS;

  const startingFonts: ThemeFonts = startingTheme?.fonts ?? {
    sans: FONT_PRESETS.sans, mono: FONT_PRESETS.mono, display: FONT_PRESETS.sans,
  };
  const startingEffects: ThemeEffects = startingTheme?.effects ?? {
    scanline_color: 'transparent',
    scanline_spacing: '3px',
    highlight_mark_color: 'rgba(0, 0, 0, 0.15)',
  };

  const startingName = props.initial
    ? (isDuplicating ? `Copy of ${props.initial.name}` : props.initial.name)
    : 'My custom theme';

  const [name,          setName]          = createSignal(startingName);
  const [description,   setDescription]   = createSignal(props.initial?.description ?? '');
  const [primary,       setPrimary]       = createSignal(startingKey.primary);
  const [secondary,     setSecondary]     = createSignal(startingKey.secondary);
  const [accent,        setAccent]        = createSignal(startingKey.accent);
  const [warning,       setWarning]       = createSignal(startingKey.warning);
  const [danger,        setDanger]        = createSignal(startingKey.danger);
  const [text,          setText]          = createSignal(startingKey.text);
  const [background,    setBackground]    = createSignal(startingKey.background);
  const initialScanlines = (startingEffects.scanline_color || 'transparent') !== 'transparent';
  const [scanlinesOn,   setScanlinesOn]   = createSignal(initialScanlines);
  const [scanlineColor, setScanlineColor] = createSignal(
    initialScanlines ? (startingEffects.scanline_color || 'rgba(255,255,255,0.03)') : 'rgba(255,255,255,0.03)'
  );
  const [highlightColor, setHighlightColor] = createSignal(startingEffects.highlight_mark_color || 'rgba(0, 0, 0, 0.15)');
  const [fontSans,    setFontSans]    = createSignal(startingFonts.sans    || FONT_PRESETS.sans);
  const [fontMono,    setFontMono]    = createSignal(startingFonts.mono    || FONT_PRESETS.mono);
  const [fontDisplay, setFontDisplay] = createSignal(startingFonts.display || FONT_PRESETS.sans);
  const [saving, setSaving] = createSignal(false);
  const [error,  setError]  = createSignal<string | null>(null);

  const buildData = (): ThemeData => buildThemeData({
    keyColors: {
      primary: primary(), secondary: secondary(), accent: accent(),
      warning: warning(), danger: danger(),
      text: text(), background: background(),
    },
    fonts: {
      sans:    fontSans(),
      mono:    fontMono(),
      display: fontDisplay(),
    },
    effects: {
      scanline_color: scanlinesOn() ? scanlineColor() : 'transparent',
      scanline_spacing: '3px',
      highlight_mark_color: highlightColor(),
    },
  });

  // Live preview — runs on mount and whenever any signal above changes.
  createEffect(() => {
    previewThemeData(buildData());
  });

  const handleCancel = () => {
    if (snapshot) applyThemeData(snapshot);
    props.onClose(false);
  };

  const handleSave = async () => {
    if (!name().trim()) {
      setError('Name is required');
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      name: name().trim(),
      description: description().trim() || null,
      theme_data: buildData(),
    };
    try {
      let savedId: number;
      if (isEditing && props.initial) {
        const updated = await api.patchTheme(props.initial.id, payload);
        savedId = updated.id;
      } else {
        const slug = slugify(name());
        const created = await api.createTheme({ ...payload, slug });
        savedId = created.id;
      }
      await activateTheme(savedId);
      await refreshThemesList();
      props.onClose(true);
    } catch (err: any) {
      // Restore snapshot so the page doesn't look broken behind the error.
      if (snapshot) applyThemeData(snapshot);
      setError(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const title = isEditing
    ? `Edit theme — ${props.initial!.name}`
    : isDuplicating
      ? `Duplicate "${props.initial!.name}"`
      : 'New theme';

  return (
    <Modal
      open={true}
      onClose={handleCancel}
      title={title}
      size="lg"
      footer={
        <>
          <button type="button" class="press press-ghost press-md" onClick={handleCancel} disabled={saving()}>
            Cancel
          </button>
          <button type="button" class="press press-primary press-md" onClick={handleSave} disabled={saving()}>
            {saving() ? 'Saving…' : 'Save & activate'}
          </button>
        </>
      }
    >
      <div class="flex flex-col gap-5">
        <Show when={error()}>
          <div class="p-2 border-2 border-scarlet-500/50 bg-scarlet-500/10 text-scarlet-300 text-[12px]">
            {error()}
          </div>
        </Show>

        <div class="text-[11px] text-base-400 italic">
          Changes preview live across the whole app. Cancel restores your previously active theme. Save persists this theme and switches to it.
        </div>

        <div class="flex flex-col gap-3">
          <label class="flex flex-col gap-1">
            <span class="text-[10px] uppercase tracking-widest text-surf-300 font-bold">Name</span>
            <input class="input-vintage" value={name()} onInput={(e) => setName(e.currentTarget.value)} />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-[10px] uppercase tracking-widest text-surf-300 font-bold">Description</span>
            <input class="input-vintage" value={description()} onInput={(e) => setDescription(e.currentTarget.value)} placeholder="A short description (optional)" />
          </label>
        </div>

        <div>
          <div class="text-[10px] uppercase tracking-widest text-surf-300 font-bold mb-2">Colors</div>
          <p class="text-[11px] text-base-400 mb-3">
            Pick anchor colors below. The 11-step ramps for buttons, borders, hovers, and disabled states are generated automatically from each anchor.
          </p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ColorRow label="Primary"    description="Main buttons, links, active nav"  value={primary()}    onInput={setPrimary} />
            <ColorRow label="Secondary"  description="Secondary buttons"                value={secondary()}  onInput={setSecondary} />
            <ColorRow label="Accent"     description="Tertiary highlights, partners"    value={accent()}     onInput={setAccent} />
            <ColorRow label="Warning"    description="Alerts and pending states"        value={warning()}    onInput={setWarning} />
            <ColorRow label="Danger"     description="Destructive buttons, errors"      value={danger()}     onInput={setDanger} />
            <ColorRow label="Text"       description="Primary text on the page"         value={text()}       onInput={setText} />
            <ColorRow label="Background" description="Page background color"            value={background()} onInput={setBackground} />
          </div>
        </div>

        <div>
          <div class="text-[10px] uppercase tracking-widest text-surf-300 font-bold mb-2">Effects</div>
          <div class="flex flex-col gap-3">
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={scanlinesOn()}
                onChange={(e) => setScanlinesOn(e.currentTarget.checked)}
                class="accent-surf-400"
              />
              <span class="text-[13px] text-base-50">Show scanlines (CRT texture overlay on the body)</span>
            </label>
            <Show when={scanlinesOn()}>
              <label class="flex flex-col gap-1">
                <span class="text-[10px] uppercase tracking-widest text-base-300">Scanline color (use low-alpha rgba so the effect stays subtle)</span>
                <input
                  class="input-vintage font-mono"
                  value={scanlineColor()}
                  onInput={(e) => setScanlineColor(e.currentTarget.value)}
                  placeholder="rgba(255, 255, 255, 0.03)"
                  spellcheck={false}
                />
              </label>
            </Show>
            <label class="flex flex-col gap-1">
              <span class="text-[10px] uppercase tracking-widest text-base-300">Search-result / mark highlight color</span>
              <input
                class="input-vintage font-mono"
                value={highlightColor()}
                onInput={(e) => setHighlightColor(e.currentTarget.value)}
                placeholder="rgba(255, 220, 0, 0.25)"
                spellcheck={false}
              />
            </label>
          </div>
        </div>

        <div>
          <div class="text-[10px] uppercase tracking-widest text-surf-300 font-bold mb-2">Fonts</div>
          <div class="flex flex-col gap-3">
            <FontRow label="Sans (body text)"          value={fontSans()}    onInput={setFontSans} />
            <FontRow label="Mono (code, data)"         value={fontMono()}    onInput={setFontMono} />
            <FontRow label="Display (headings)"        value={fontDisplay()} onInput={setFontDisplay} />
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ColorRow(props: { label: string; description?: string; value: string; onInput: (v: string) => void }) {
  return (
    <div class="flex flex-col gap-1">
      <span class="text-[10px] uppercase tracking-widest text-base-300 font-bold">{props.label}</span>
      <div class="flex items-center gap-2">
        <input
          type="color"
          value={normalizeForPicker(props.value)}
          onInput={(e) => props.onInput(e.currentTarget.value)}
          class="w-11 h-11 cursor-pointer border-2 border-base-500 bg-transparent p-0 shrink-0"
          aria-label={`${props.label} color picker`}
        />
        <input
          type="text"
          value={props.value}
          onInput={(e) => props.onInput(e.currentTarget.value)}
          class="input-vintage font-mono flex-1 min-w-0"
          spellcheck={false}
          aria-label={`${props.label} hex value`}
        />
      </div>
      <Show when={props.description}>
        <span class="text-[10px] text-base-500">{props.description}</span>
      </Show>
    </div>
  );
}

function FontRow(props: { label: string; value: string; onInput: (v: string) => void }) {
  const setPreset = (preset: keyof typeof FONT_PRESETS) => () => props.onInput(FONT_PRESETS[preset]);
  return (
    <div class="flex flex-col gap-1">
      <span class="text-[10px] uppercase tracking-widest text-base-300 font-bold">{props.label}</span>
      <input
        class="input-vintage font-mono text-[12px]"
        value={props.value}
        onInput={(e) => props.onInput(e.currentTarget.value)}
        spellcheck={false}
      />
      <div class="flex flex-wrap gap-1 mt-1">
        <button type="button" onClick={setPreset('sans')}    class="border-2 border-base-500 bg-base-950 hover:border-surf-300 hover:text-surf-200 text-base-300 text-[10px] uppercase tracking-widest px-2 py-1 transition-colors">Sans</button>
        <button type="button" onClick={setPreset('serif')}   class="border-2 border-base-500 bg-base-950 hover:border-surf-300 hover:text-surf-200 text-base-300 text-[10px] uppercase tracking-widest px-2 py-1 transition-colors">Serif</button>
        <button type="button" onClick={setPreset('mono')}    class="border-2 border-base-500 bg-base-950 hover:border-surf-300 hover:text-surf-200 text-base-300 text-[10px] uppercase tracking-widest px-2 py-1 transition-colors">Mono</button>
        <button type="button" onClick={setPreset('display')} class="border-2 border-base-500 bg-base-950 hover:border-surf-300 hover:text-surf-200 text-base-300 text-[10px] uppercase tracking-widest px-2 py-1 transition-colors">Display</button>
      </div>
    </div>
  );
}
