// Themes — visual styling for the GUI. Two operations split between two
// tables: CRUD on themes (built-in + user-created) and the per-user pointer
// to "which theme is active right now" (user_theme_settings).
//
// RLS does the heavy lifting:
//   - themes_select   makes built-ins visible to everyone
//   - themes_insert/update/delete restrict writes to the caller's own rows
//     (and forbid is_builtin = TRUE entirely)
//   - user_theme_settings_isolation is the standard per-user policy
//
// As a result this service can largely speak SQL directly without checking
// ownership in JS — the DB rejects the operation if the policy fails. The
// explicit is_builtin guards below are still present so we can return a
// clear 403 error message instead of letting the policy yield an opaque
// "row not found" on UPDATE/DELETE.

import { withUser } from '../../db/connection.js';
import { badRequest, notFound, forbidden, conflict } from '../../lib/http-error.js';

const RAMP_NAMES = ['surf', 'cerulean', 'amber', 'papaya', 'scarlet', 'base'];
const RAMP_STEPS = 11;
const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;
const SLUG_RE = /^[a-z0-9-]+$/;
const VALID_FONT_KEYS = new Set(['sans', 'mono', 'display']);
const VALID_EFFECT_KEYS = new Set(['scanline_color', 'scanline_spacing', 'highlight_mark_color']);

function validateSlug(slug) {
  if (!slug || typeof slug !== 'string') throw badRequest('slug is required');
  if (!SLUG_RE.test(slug)) {
    throw badRequest(`Invalid slug "${slug}": must be lowercase letters, digits, and dashes`);
  }
  return slug;
}

function validateThemeData(theme_data) {
  if (!theme_data || typeof theme_data !== 'object') {
    throw badRequest('theme_data must be an object');
  }
  const colors = theme_data.colors;
  if (!colors || typeof colors !== 'object') {
    throw badRequest('theme_data.colors must be an object');
  }
  for (const name of RAMP_NAMES) {
    const ramp = colors[name];
    if (!Array.isArray(ramp) || ramp.length !== RAMP_STEPS) {
      throw badRequest(`theme_data.colors.${name} must be an array of ${RAMP_STEPS} hex strings (50..950)`);
    }
    for (const v of ramp) {
      if (typeof v !== 'string' || !HEX_RE.test(v)) {
        throw badRequest(`Invalid color in ramp "${name}": ${JSON.stringify(v)} (expected hex like "#abc" or "#aabbcc")`);
      }
    }
  }
  if (theme_data.fonts !== undefined) {
    if (theme_data.fonts === null || typeof theme_data.fonts !== 'object') {
      throw badRequest('theme_data.fonts must be an object (or absent)');
    }
    for (const k of Object.keys(theme_data.fonts)) {
      if (!VALID_FONT_KEYS.has(k)) {
        throw badRequest(`Unknown font key "${k}" (valid: sans, mono, display)`);
      }
      const v = theme_data.fonts[k];
      if (v != null && typeof v !== 'string') {
        throw badRequest(`theme_data.fonts.${k} must be a string`);
      }
    }
  }
  if (theme_data.effects !== undefined) {
    if (theme_data.effects === null || typeof theme_data.effects !== 'object') {
      throw badRequest('theme_data.effects must be an object (or absent)');
    }
    for (const k of Object.keys(theme_data.effects)) {
      if (!VALID_EFFECT_KEYS.has(k)) {
        throw badRequest(`Unknown effect key "${k}" (valid: scanline_color, scanline_spacing, highlight_mark_color)`);
      }
      const v = theme_data.effects[k];
      if (v != null && typeof v !== 'string') {
        throw badRequest(`theme_data.effects.${k} must be a string`);
      }
    }
  }
  return theme_data;
}

const COLS = 'id, user_id, slug, name, description, theme_data, is_builtin, created_at, updated_at';

export class ThemesService {
  // Built-ins + caller's own themes. RLS handles the filtering. Sorted with
  // built-ins first (so the system themes always lead the picker), then by
  // name alphabetically.
  async list(userId) {
    return withUser(userId, async (client) => {
      const rows = (await client.query(
        `SELECT ${COLS}
         FROM themes
         ORDER BY is_builtin DESC, lower(name) ASC, id ASC`
      )).rows;
      return { themes: rows };
    });
  }

  async get(userId, id) {
    return withUser(userId, async (client) => {
      const row = (await client.query(
        `SELECT ${COLS} FROM themes WHERE id = $1`,
        [id]
      )).rows[0];
      if (!row) throw notFound(`Theme ${id} not found`);
      return row;
    });
  }

  async create(userId, { slug, name, description, theme_data }) {
    validateSlug(slug);
    if (!name || typeof name !== 'string') {
      throw badRequest('name is required');
    }
    validateThemeData(theme_data);
    return withUser(userId, async (client) => {
      try {
        const row = (await client.query(
          `INSERT INTO themes (user_id, slug, name, description, theme_data, is_builtin)
           VALUES (current_setting('app.current_user_id')::bigint, $1, $2, $3, $4::jsonb, FALSE)
           RETURNING ${COLS}`,
          [slug, name, description || null, JSON.stringify(theme_data)]
        )).rows[0];
        return row;
      } catch (err) {
        if (err.code === '23505') {
          throw conflict(`A theme with slug "${slug}" already exists`);
        }
        throw err;
      }
    });
  }

  async update(userId, id, patch) {
    return withUser(userId, async (client) => {
      const existing = (await client.query(
        `SELECT ${COLS} FROM themes WHERE id = $1`,
        [id]
      )).rows[0];
      if (!existing) throw notFound(`Theme ${id} not found`);
      if (existing.is_builtin) {
        throw forbidden('Built-in themes cannot be modified — duplicate it to create your own editable copy');
      }

      const fields = {};
      if (patch.name !== undefined) {
        if (!patch.name || typeof patch.name !== 'string') {
          throw badRequest('name must be a non-empty string');
        }
        fields.name = patch.name;
      }
      if (patch.description !== undefined) {
        fields.description = patch.description || null;
      }
      if (patch.slug !== undefined) {
        validateSlug(patch.slug);
        fields.slug = patch.slug;
      }
      if (patch.theme_data !== undefined) {
        validateThemeData(patch.theme_data);
        fields.theme_data = patch.theme_data;
      }
      if (Object.keys(fields).length === 0) return existing;

      const merged = { ...existing, ...fields };
      try {
        const row = (await client.query(
          `UPDATE themes
           SET slug = $1, name = $2, description = $3, theme_data = $4::jsonb
           WHERE id = $5
           RETURNING ${COLS}`,
          [merged.slug, merged.name, merged.description, JSON.stringify(merged.theme_data), id]
        )).rows[0];
        return row;
      } catch (err) {
        if (err.code === '23505') {
          throw conflict(`A theme with slug "${merged.slug}" already exists`);
        }
        throw err;
      }
    });
  }

  async delete(userId, id) {
    return withUser(userId, async (client) => {
      const existing = (await client.query(
        `SELECT id, is_builtin FROM themes WHERE id = $1`,
        [id]
      )).rows[0];
      if (!existing) throw notFound(`Theme ${id} not found`);
      if (existing.is_builtin) throw forbidden('Built-in themes cannot be deleted');
      await client.query(`DELETE FROM themes WHERE id = $1`, [id]);
      return { ok: true };
    });
  }

  // The active theme for the caller. Falls back to the "default" built-in if
  // no row exists in user_theme_settings yet, or if the row points at a theme
  // that's since been deleted (ON DELETE SET NULL covers most of that, but
  // defending against the gap is cheap).
  async getActive(userId) {
    return withUser(userId, (client) => readActive(client));
  }

  // Switch active theme. Pass null to clear (returns the user to the default
  // built-in via the fallback in readActive).
  async setActive(userId, themeId) {
    if (themeId !== null && themeId !== undefined) {
      const n = parseInt(themeId, 10);
      if (!Number.isInteger(n) || n <= 0) {
        throw badRequest('theme_id must be a positive integer (or null to clear)');
      }
      themeId = n;
    } else {
      themeId = null;
    }

    return withUser(userId, async (client) => {
      if (themeId !== null) {
        const exists = (await client.query(
          `SELECT id FROM themes WHERE id = $1`,
          [themeId]
        )).rows[0];
        if (!exists) throw notFound(`Theme ${themeId} not found or not visible to you`);
      }
      await client.query(
        `INSERT INTO user_theme_settings (user_id, active_theme_id)
         VALUES (current_setting('app.current_user_id')::bigint, $1)
         ON CONFLICT (user_id) DO UPDATE SET active_theme_id = EXCLUDED.active_theme_id`,
        [themeId]
      );
      // Reading via the same client keeps the read inside the open transaction
      // — calling this.getActive() here would open a separate connection that
      // can't see the uncommitted upsert.
      return readActive(client);
    });
  }
}

// Shared helper: read the active theme using an existing client/transaction
// rather than starting a fresh withUser. Falls back to the default built-in
// when the user has no setting or their saved theme has been deleted.
async function readActive(client) {
  const settingRow = (await client.query(
    `SELECT active_theme_id FROM user_theme_settings
     WHERE user_id = current_setting('app.current_user_id')::bigint`
  )).rows[0];

  const activeId = settingRow?.active_theme_id || null;
  let theme = null;
  if (activeId) {
    theme = (await client.query(
      `SELECT ${COLS} FROM themes WHERE id = $1`,
      [activeId]
    )).rows[0] || null;
  }
  if (!theme) {
    theme = (await client.query(
      `SELECT ${COLS} FROM themes WHERE slug = 'default' AND user_id IS NULL`
    )).rows[0] || null;
  }
  return { active_theme_id: theme?.id || null, theme };
}
