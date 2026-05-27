// Seed five built-in themes. Each row has user_id=NULL (visible to every user
// via the themes_select RLS policy) and is_builtin=TRUE (locked against edits
// and deletes by the other RLS policies — built-ins move only through migrations).
//
// Each theme_data blob is structured:
//
//   {
//     "colors": {
//       "surf":     [11 hex strings],   // primary accent
//       "cerulean": [11 hex strings],   // secondary accent
//       "amber":    [11 hex strings],   // warnings
//       "papaya":   [11 hex strings],   // tertiary accent
//       "scarlet":  [11 hex strings],   // destructive
//       "base":     [11 hex strings]    // neutrals: index 0 = primary text, index 10 = page background
//     },
//     "fonts":   { "sans": "...", "mono": "...", "display": "..." },
//     "effects": {
//       "scanline_color":       "rgba(...)" | "transparent",
//       "scanline_spacing":     "3px",
//       "highlight_mark_color": "rgba(...)"
//     }
//   }
//
// The 11 ramp steps map to Tailwind's 50/100/200/300/400/500/600/700/800/900/950
// in order. Index 0 is the "text" end of the ramp, index 10 is the "background"
// end — that's the convention the app already follows (e.g. text-base-50 is
// the primary text color, bg-base-950 is the page background).
//
// Idempotency: ON CONFLICT (slug) on the partial unique index for built-ins
// updates every field. Edit a theme here and re-run migrations to push.

const DEFAULT_THEME = {
  // Clean light / professional. Blue primary, neutral grays, no scanlines.
  // This is what brand-new users see — no scanlines, no monospace body,
  // no warm amber palette. Bland on purpose.
  colors: {
    surf:     ['#1e40af','#1d4ed8','#2563eb','#3b82f6','#60a5fa','#3b82f6','#1d4ed8','#1e40af','#1e3a8a','#172554','#0a1532'],
    cerulean: ['#0f172a','#1e293b','#334155','#475569','#64748b','#94a3b8','#cbd5e1','#e2e8f0','#f1f5f9','#f8fafc','#ffffff'],
    amber:    ['#422006','#713f12','#854d0e','#a16207','#ca8a04','#eab308','#facc15','#fde047','#fef08a','#fef9c3','#fefce8'],
    papaya:   ['#134e4a','#115e59','#0f766e','#0d9488','#14b8a6','#2dd4bf','#5eead4','#99f6e4','#ccfbf1','#f0fdfa','#ecfeff'],
    scarlet:  ['#450a0a','#7f1d1d','#991b1b','#b91c1c','#dc2626','#ef4444','#f87171','#fca5a5','#fecaca','#fee2e2','#fef2f2'],
    base:     ['#0f172a','#1e293b','#334155','#475569','#64748b','#94a3b8','#cbd5e1','#e2e8f0','#f1f5f9','#f8fafc','#ffffff'],
  },
  fonts: {
    sans:    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    mono:    "ui-monospace, 'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace",
    display: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  effects: {
    scanline_color: 'transparent',
    scanline_spacing: '3px',
    highlight_mark_color: 'rgba(37, 99, 235, 0.18)',
  },
};

const VINTAGE_CRT_THEME = {
  // The current app design — warm coffee-black with mustard primary, rust
  // secondary, faint amber scanlines, monospace body, serif headings.
  colors: {
    surf:     ['#fdecc8','#f9dca3','#f2c677','#e6ac4a','#d49322','#b57800','#8c5f00','#6b4800','#4a3200','#2a1c00','#140d00'],
    cerulean: ['#f6e0ce','#eec6ad','#e5a986','#d88a5c','#c86933','#b04c13','#8f3c08','#702b00','#4d1c00','#2d0e00','#180600'],
    amber:    ['#fff6d0','#ffebaa','#ffdb71','#ffc938','#f2b700','#d4a000','#a17900','#755800','#4a3800','#241b00','#171100'],
    papaya:   ['#eff0d8','#dde0b1','#c6cb87','#a9b15c','#8e9845','#707a34','#575f28','#41471d','#2c3013','#161809','#0d0f05'],
    scarlet:  ['#f8dcd7','#efb6ad','#e38a7c','#d25c4c','#b63d2e','#912a1e','#721f15','#54170f','#370f0a','#1b0705','#120503'],
    base:     ['#f2e7d0','#e0cfb3','#c5b295','#9f8b71','#7a6952','#564834','#3a3022','#2a231a','#1e1912','#14110c','#0d0b08'],
  },
  fonts: {
    sans:    "ui-monospace, 'SF Mono', 'Monaco', 'Menlo', 'Courier New', monospace",
    mono:    "ui-monospace, 'SF Mono', 'Monaco', 'Menlo', 'Courier New', monospace",
    display: "Georgia, 'Times New Roman', Cambria, 'Iowan Old Style', serif",
  },
  effects: {
    scanline_color: 'rgba(181, 120, 0, 0.015)',
    scanline_spacing: '3px',
    highlight_mark_color: 'rgba(212, 147, 34, 0.25)',
  },
};

const CYBERPUNK_THEME = {
  // Neon dark — cyan primary, magenta secondary, near-black backgrounds,
  // mono throughout, faint cyan scanlines (denser than CRT — 2px).
  colors: {
    surf:     ['#ecfeff','#cffafe','#a5f3fc','#67e8f9','#22d3ee','#06b6d4','#0891b2','#0e7490','#155e75','#164e63','#083344'],
    cerulean: ['#fdf2f8','#fce7f3','#fbcfe8','#f9a8d4','#f472b6','#ec4899','#db2777','#be185d','#9d174d','#831843','#500724'],
    amber:    ['#fefce8','#fef9c3','#fef08a','#fde047','#facc15','#eab308','#ca8a04','#a16207','#854d0e','#713f12','#422006'],
    papaya:   ['#f0fdf4','#dcfce7','#bbf7d0','#86efac','#4ade80','#22c55e','#16a34a','#15803d','#166534','#14532d','#052e16'],
    scarlet:  ['#fef2f2','#fee2e2','#fecaca','#fca5a5','#f87171','#ef4444','#dc2626','#b91c1c','#7f1d1d','#5d0c0c','#1e0404'],
    base:     ['#e0f7ff','#b5e4f7','#7cc8e8','#4ba3c8','#2e7a9c','#1d5570','#143b50','#0c2638','#081827','#040d18','#02060c'],
  },
  fonts: {
    sans:    "'JetBrains Mono', 'Fira Code', ui-monospace, 'SF Mono', monospace",
    mono:    "'JetBrains Mono', 'Fira Code', ui-monospace, 'SF Mono', monospace",
    display: "'JetBrains Mono', 'Fira Code', ui-monospace, 'SF Mono', monospace",
  },
  effects: {
    scanline_color: 'rgba(34, 211, 238, 0.035)',
    scanline_spacing: '2px',
    highlight_mark_color: 'rgba(236, 72, 153, 0.28)',
  },
};

const FOREST_THEME = {
  // Earthy / organic — deep forest greens for backgrounds, cream/wheat for
  // text. Olive primary, autumn-rust secondary. No scanlines (the CRT motif
  // doesn't belong in a forest cabin). Serif headings, serif body.
  colors: {
    surf:     ['#f7f9e8','#eef1cf','#dde2a5','#c3cd70','#a3b248','#7e8f2d','#62721f','#4a5717','#353e10','#1f2509','#131705'],
    cerulean: ['#fef0e6','#fcd9bd','#f7b58d','#ee8b56','#d96523','#b54a0e','#8b3608','#672805','#441a03','#220d02','#110600'],
    amber:    ['#fff7ce','#ffedaa','#ffdc7d','#ffc94a','#f0b020','#c89000','#976d00','#6d4f00','#463300','#221900','#110c00'],
    papaya:   ['#e8f5f0','#c9e8db','#9bd4c0','#65b89e','#3a9676','#1d7456','#135942','#0c4231','#082c21','#041610','#020a07'],
    scarlet:  ['#fce6dd','#f6c1a8','#ec9070','#db5d39','#b8401e','#8e2e13','#6b220e','#4d180a','#2f0e06','#170703','#0a0301'],
    base:     ['#fef3c7','#f5e9b3','#dccc92','#b9aa72','#8e8254','#65603a','#4a4827','#33321b','#222113','#13140a','#0a0c05'],
  },
  fonts: {
    sans:    "'Source Serif Pro', 'Iowan Old Style', Georgia, 'Times New Roman', serif",
    mono:    "'JetBrains Mono', ui-monospace, 'Menlo', monospace",
    display: "'Source Serif Pro', 'Iowan Old Style', Georgia, 'Times New Roman', serif",
  },
  effects: {
    scanline_color: 'transparent',
    scanline_spacing: '3px',
    highlight_mark_color: 'rgba(163, 178, 72, 0.30)',
  },
};

const PAPER_THEME = {
  // Warm parchment — light theme styled like an old book page. Crimson
  // primary, navy secondary, mustard warning. Serif throughout (Crimson Text
  // for display, Georgia for body). No scanlines.
  colors: {
    surf:     ['#fce4e0','#f8c1b8','#ed9081','#de6151','#c43e2e','#9c2a1d','#781e14','#58150e','#390d08','#1c0603','#0e0301'],
    cerulean: ['#e6ebf2','#c2cfdf','#93acc6','#6486a5','#426582','#2a4761','#1d3349','#142435','#0c1722','#060c12','#03060a'],
    amber:    ['#fdf2c7','#fae08a','#f5c84a','#ddae22','#b88e10','#8e6d08','#6a5106','#4d3a04','#312402','#181101','#0c0900'],
    papaya:   ['#f1f0d8','#dfdfb0','#c5c581','#a4a653','#84882f','#656b1a','#4d5212','#383c0c','#232506','#111302','#080901'],
    scarlet:  ['#f5d8d2','#e8a99e','#d6786a','#be4d3c','#9d3023','#7a1f14','#5a160d','#3f0f09','#260804','#110402','#080201'],
    base:     ['#2a1a0e','#3d2818','#5a3c25','#7d5938','#9c7951','#b59875','#ccb39a','#ddc8b3','#ecdec8','#f5ead8','#faf3e6'],
  },
  fonts: {
    sans:    "Georgia, 'Iowan Old Style', 'Times New Roman', Cambria, serif",
    mono:    "'Courier New', Courier, ui-monospace, monospace",
    display: "'Crimson Text', 'Iowan Old Style', Georgia, 'Times New Roman', serif",
  },
  effects: {
    scanline_color: 'transparent',
    scanline_spacing: '3px',
    highlight_mark_color: 'rgba(156, 42, 29, 0.20)',
  },
};

const THEMES = [
  {
    slug: 'default',
    name: 'Default',
    description: 'Clean light theme with a blue primary. Bland on purpose — no scanlines, no monospace, neutral grays.',
    data: DEFAULT_THEME,
  },
  {
    slug: 'vintage-crt',
    name: 'Vintage CRT',
    description: 'Warm coffee-black with mustard primary, rust secondary, faint amber scanlines, monospace body, serif headings. The original app palette.',
    data: VINTAGE_CRT_THEME,
  },
  {
    slug: 'cyberpunk',
    name: 'Cyberpunk',
    description: 'Neon dark — cyan primary, magenta secondary, near-black backgrounds, cyan scanlines, monospace throughout.',
    data: CYBERPUNK_THEME,
  },
  {
    slug: 'forest',
    name: 'Forest',
    description: 'Earthy and organic. Deep forest greens, cream/wheat text, olive primary, autumn-rust secondary, serif body.',
    data: FOREST_THEME,
  },
  {
    slug: 'paper',
    name: 'Paper',
    description: 'Warm parchment light theme styled like an old book — crimson primary, navy secondary, mustard warnings, serif throughout.',
    data: PAPER_THEME,
  },
];

exports.up = (pgm) => {
  // Build a single multi-row INSERT. The ON CONFLICT clause targets the
  // partial unique index themes_builtin_slug_uniq (slug WHERE user_id IS NULL)
  // — Postgres infers it from the inferred column set + the predicate.
  const values = THEMES.map((t) => {
    const dataJson = JSON.stringify(t.data).replace(/'/g, "''");
    const descLit  = t.description.replace(/'/g, "''");
    return `(NULL, '${t.slug}', '${t.name}', '${descLit}', '${dataJson}'::jsonb, TRUE)`;
  }).join(',\n      ');

  pgm.sql(`
    INSERT INTO themes (user_id, slug, name, description, theme_data, is_builtin)
    VALUES
      ${values}
    ON CONFLICT (slug) WHERE user_id IS NULL DO UPDATE
      SET name        = EXCLUDED.name,
          description = EXCLUDED.description,
          theme_data  = EXCLUDED.theme_data,
          is_builtin  = TRUE;
  `);
};

// Down: removing built-ins would orphan user_theme_settings rows (FK is ON
// DELETE SET NULL so it's safe; but rather than wipe data, the down here just
// strips the seeded built-ins. Users with a built-in as their active theme
// fall through to the application-level default-built-in lookup.)
exports.down = (pgm) => {
  const slugs = THEMES.map((t) => `'${t.slug}'`).join(', ');
  pgm.sql(`DELETE FROM themes WHERE user_id IS NULL AND slug IN (${slugs});`);
};
