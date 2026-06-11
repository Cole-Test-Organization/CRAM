// Theme provider — fetches the user's active theme from the API and applies
// it as CSS custom properties on :root via a single <style id="active-theme-vars">
// element appended to <head>. The CSS in gui/src/index.css already references
// every theme-controllable value via var(--color-*-*), var(--font-*), and the
// var(--scanline-*) / var(--highlight-*) helpers, so overriding the variables
// at runtime reflows the entire app without rebuilding.
//
// Caching: the active theme is also stashed in localStorage so we can apply it
// synchronously on page load (in main.tsx, before SolidJS renders) and avoid
// a flash of the default-baked CSS. The cache is refreshed every time the API
// is hit, so a stale cache self-heals on first network round-trip.

import { createSignal } from 'solid-js';
import { api } from './api';
// Recolorable twin of public/favicon.svg (the pre-JS, baked-default icon). It's
// a single-fill monochrome mark — one fill="" on the root, inherited by every
// path — so applyFavicon() recolors the whole thing by swapping that one
// attribute. Keep the two SVGs visually identical; public/ is just the default
// shown before this module runs.
import faviconSvg from '../assets/favicon.svg?raw';

export type ThemeColors = {
  surf:     string[];
  cerulean: string[];
  amber:    string[];
  papaya:   string[];
  scarlet:  string[];
  base:     string[];
};

export type ThemeFonts = {
  sans?:    string;
  mono?:    string;
  display?: string;
};

export type ThemeEffects = {
  scanline_color?:       string;
  scanline_spacing?:     string;
  highlight_mark_color?: string;
};

export type ThemeData = {
  colors:   ThemeColors;
  fonts?:   ThemeFonts;
  effects?: ThemeEffects;
};

export type Theme = {
  id:          number;
  user_id:     number | null;
  slug:        string;
  name:        string;
  description: string | null;
  theme_data:  ThemeData;
  is_builtin:  boolean;
  created_at:  string;
  updated_at:  string;
};

export const RAMP_NAMES = ['surf', 'cerulean', 'amber', 'papaya', 'scarlet', 'base'] as const;
export const RAMP_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

export const STORAGE_KEY = 'cram-active-theme';
const STYLE_ID    = 'active-theme-vars';

// ── CSS injection ────────────────────────────────────────────────────────────

export function themeDataToCss(data: ThemeData): string {
  const lines: string[] = [];
  for (const name of RAMP_NAMES) {
    const ramp = data.colors[name];
    if (!ramp) continue;
    for (let i = 0; i < RAMP_STEPS.length; i++) {
      const color = ramp[i];
      if (color) lines.push(`--color-${name}-${RAMP_STEPS[i]}: ${color};`);
    }
  }
  if (data.fonts) {
    if (data.fonts.sans)    lines.push(`--font-sans: ${data.fonts.sans};`);
    if (data.fonts.mono)    lines.push(`--font-mono: ${data.fonts.mono};`);
    if (data.fonts.display) lines.push(`--font-display: ${data.fonts.display};`);
  }
  if (data.effects) {
    if (data.effects.scanline_color       != null) lines.push(`--scanline-color: ${data.effects.scanline_color};`);
    if (data.effects.scanline_spacing     != null) lines.push(`--scanline-spacing: ${data.effects.scanline_spacing};`);
    if (data.effects.highlight_mark_color != null) lines.push(`--highlight-mark-color: ${data.effects.highlight_mark_color};`);
  }
  return `:root {\n  ${lines.join('\n  ')}\n}`;
}

// Build a data-URI copy of the favicon tinted with `color`. encodeURIComponent
// (not base64) keeps it human-readable and correctly escapes the '#' in hex.
function themedFaviconHref(color: string): string {
  const svg = faviconSvg.replace(/fill="[^"]*"/, `fill="${color}"`);
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// Point <link rel="icon"> at the favicon recolored to the theme's primary
// accent (surf-500 — the same token the ThemeCard swatch and Active badge use).
// Falls back through surf-400 to the original amber for malformed data.
function applyFavicon(data: ThemeData) {
  if (typeof document === 'undefined') return;
  const color = data.colors?.surf?.[5] ?? data.colors?.surf?.[4] ?? '#d49322';
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.type = 'image/svg+xml';
  link.href = themedFaviconHref(color);
}

export function applyThemeData(data: ThemeData, { cache = true }: { cache?: boolean } = {}) {
  if (typeof document === 'undefined') return;
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = themeDataToCss(data);
  applyFavicon(data);
  if (cache) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* private mode etc. */ }
  }
}

// Synchronously apply whatever theme is in localStorage. Call from main.tsx
// before render() to avoid the brief flash of the baked-in default while the
// API request resolves.
export function applyCachedTheme() {
  if (typeof document === 'undefined') return;
  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) applyThemeData(JSON.parse(cached), { cache: false });
  } catch { /* corrupted cache — just skip */ }
}

// ── Reactive state ───────────────────────────────────────────────────────────

const [activeTheme, _setActiveTheme] = createSignal<Theme | null>(null);
const [themesList, _setThemesList]   = createSignal<Theme[]>([]);

export { activeTheme, themesList };

export async function refreshActiveTheme(): Promise<Theme | null> {
  try {
    const { theme } = await api.getActiveTheme();
    if (theme) {
      _setActiveTheme(theme);
      applyThemeData(theme.theme_data);
    }
    return theme;
  } catch {
    return null;
  }
}

export async function refreshThemesList(): Promise<Theme[]> {
  const { themes } = await api.listThemes();
  _setThemesList(themes);
  return themes;
}

export async function activateTheme(themeId: number | null): Promise<Theme | null> {
  const { theme } = await api.setActiveTheme(themeId);
  if (theme) {
    _setActiveTheme(theme);
    applyThemeData(theme.theme_data);
  }
  return theme;
}

// Live-preview shim. The editor calls this on every color/font change to apply
// the in-progress theme without persisting. Restore by calling refreshActiveTheme()
// (or applyThemeData with the saved snapshot).
export function previewThemeData(data: ThemeData) {
  applyThemeData(data, { cache: false });
}

// ── Ramp generation (for the user-facing color picker) ───────────────────────

// Convert hex (#rgb, #rrggbb) to HSL. Returns null for invalid input.
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.replace('#', '').trim();
  if (h.length === 3) {
    return {
      r: parseInt(h[0] + h[0], 16),
      g: parseInt(h[1] + h[1], 16),
      b: parseInt(h[2] + h[2], 16),
    };
  }
  if (h.length === 6) {
    return {
      r: parseInt(h.substring(0, 2), 16),
      g: parseInt(h.substring(2, 4), 16),
      b: parseInt(h.substring(4, 6), 16),
    };
  }
  return null;
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = ((b - r) / d + 2); break;
      case b: h = ((r - g) / d + 4); break;
    }
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if      (h < 60)  { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

function clamp255(n: number) { return Math.max(0, Math.min(255, Math.round(n))); }

function rgbToHex(r: number, g: number, b: number): string {
  const hex = (n: number) => clamp255(n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

export function hexToHsl(hex: string) {
  const rgb = hexToRgb(hex);
  if (!rgb) return { h: 0, s: 0, l: 50 };
  return rgbToHsl(rgb.r, rgb.g, rgb.b);
}

export function hslToHex(h: number, s: number, l: number) {
  const { r, g, b } = hslToRgb(
    ((h % 360) + 360) % 360,
    Math.max(0, Math.min(100, s)),
    Math.max(0, Math.min(100, l)),
  );
  return rgbToHex(r, g, b);
}

// Generate an 11-step ramp from a "500" anchor color (the user's picked hex).
// Light steps (50..400) hold fixed target lightnesses and reduce saturation
// for a tinted-pastel look. Dark steps (600..950) shift lightness downward
// from the anchor in fixed increments. The anchor itself appears unchanged at
// index 5 (the "500" step).
const RAMP_LIGHT_LIGHTNESSES = [96, 90, 80, 66, 56];          // indices 0..4
const RAMP_DARK_OFFSETS      = [-8, -18, -30, -42, -50];      // indices 6..10
const RAMP_SAT_FACTORS       = [0.45, 0.55, 0.70, 0.85, 0.95, 1, 0.97, 0.92, 0.85, 0.75, 0.6];

export function generateColorRamp(anchorHex: string): string[] {
  const { h, s, l } = hexToHsl(anchorHex);
  const out: string[] = [];
  for (let i = 0; i < 11; i++) {
    let targetL: number;
    if (i < 5) targetL = RAMP_LIGHT_LIGHTNESSES[i];
    else if (i === 5) targetL = l;
    else targetL = Math.max(2, l + RAMP_DARK_OFFSETS[i - 6]);
    out.push(hslToHex(h, s * RAMP_SAT_FACTORS[i], targetL));
  }
  return out;
}

// Generate a "base" (neutral) ramp by linearly interpolating between the text
// color (index 0 / step 50) and the background color (index 10 / step 950).
// Works for both light themes (text dark, bg light) and dark themes (text
// light, bg dark) — the convention in this app is index 0 = text-end, index
// 10 = bg-end, regardless of theme direction.
export function generateBaseRamp(textHex: string, bgHex: string): string[] {
  const text = hexToHsl(textHex);
  const bg   = hexToHsl(bgHex);
  // Choose the short arc for hue interpolation (handles e.g. text=red, bg=blue).
  let dh = bg.h - text.h;
  if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const out: string[] = [];
  for (let i = 0; i < 11; i++) {
    const t = i / 10;
    const h = text.h + dh * t;
    const s = text.s + (bg.s - text.s) * t;
    const l = text.l + (bg.l - text.l) * t;
    out.push(hslToHex(h, s, l));
  }
  return out;
}

// Extract the user-facing "key colors" from a full theme — used to populate
// the editor when starting from an existing theme as a preset.
export function keyColorsFromTheme(data: ThemeData) {
  return {
    primary:    data.colors.surf?.[5]     || '#3b82f6',
    secondary:  data.colors.cerulean?.[5] || '#64748b',
    accent:     data.colors.papaya?.[5]   || '#0d9488',
    warning:    data.colors.amber?.[5]    || '#eab308',
    danger:     data.colors.scarlet?.[5]  || '#dc2626',
    text:       data.colors.base?.[0]     || '#1a1a1a',
    background: data.colors.base?.[10]    || '#ffffff',
  };
}

export type KeyColors = ReturnType<typeof keyColorsFromTheme>;

// Build a full ThemeData from user-picked key colors + fonts + effects. This
// is what the editor calls on Save to assemble the request payload.
export function buildThemeData(opts: {
  keyColors: KeyColors;
  fonts?:    ThemeFonts;
  effects?:  ThemeEffects;
}): ThemeData {
  return {
    colors: {
      surf:     generateColorRamp(opts.keyColors.primary),
      cerulean: generateColorRamp(opts.keyColors.secondary),
      papaya:   generateColorRamp(opts.keyColors.accent),
      amber:    generateColorRamp(opts.keyColors.warning),
      scarlet:  generateColorRamp(opts.keyColors.danger),
      base:     generateBaseRamp(opts.keyColors.text, opts.keyColors.background),
    },
    fonts:   opts.fonts,
    effects: opts.effects,
  };
}
