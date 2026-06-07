// Per-user agent memories — long-lived preferences, rules, and facts injected
// into the agent's system prompt at session start. Enabled rows are rendered
// into the instructions markdown so the LLM sees them as ambient context;
// disabled rows stay in the DB but are skipped (lets the user mute without
// deleting). Standard per-user RLS pattern.

import { withUser } from '../../db/connection.js';
import { badRequest } from '../../lib/http-error.js';

const COLS = `id, user_id, title, content, enabled, created_at, updated_at`;

function normalizeTitle(t: unknown) {
  if (t == null) return null;
  const trimmed = String(t).trim();
  return trimmed.length ? trimmed : null;
}

function validateContent(c: unknown) {
  if (typeof c !== 'string' || !c.trim()) {
    throw badRequest('content is required — a non-empty string describing the preference/rule/fact to remember.');
  }
  return c.trim();
}

export class MemoriesService {
  async list(userId: number, { enabled, search, limit = 100, offset = 0 }: { enabled?: boolean; search?: string; limit?: number; offset?: number } = {}) {
    return withUser(userId, async (client) => {
      const where = [];
      const params = [];
      if (enabled === true || enabled === false) {
        params.push(enabled);
        where.push(`enabled = $${params.length}`);
      }
      if (search && search.trim()) {
        params.push(`%${search.trim()}%`);
        where.push(`(title ILIKE $${params.length} OR content ILIKE $${params.length})`);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      params.push(limit, offset);
      const rows = (await client.query(
        `SELECT ${COLS}
         FROM user_memories
         ${whereSql}
         ORDER BY created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      )).rows;
      const totalParams = params.slice(0, params.length - 2);
      const total = (await client.query(
        `SELECT COUNT(*)::int AS c FROM user_memories ${whereSql}`,
        totalParams
      )).rows[0].c;
      return { memories: rows, total };
    });
  }

  // Lean fetch used by buildAgentMarkdown to render the system-prompt slice.
  // Returns only enabled rows, ordered newest first, no pagination.
  async listEnabledForInjection(userId: number) {
    return withUser(userId, async (client) => {
      return (await client.query(
        `SELECT id, title, content
         FROM user_memories
         WHERE enabled = TRUE
         ORDER BY created_at DESC`
      )).rows;
    });
  }

  async getById(userId: number, id: number) {
    return withUser(userId, async (client) => {
      const row = (await client.query(
        `SELECT ${COLS} FROM user_memories WHERE id = $1`,
        [id]
      )).rows[0];
      return row || null;
    });
  }

  async create(userId: number, { title, content, enabled }: { title?: string | null; content?: string; enabled?: boolean }) {
    const cleanContent = validateContent(content);
    const cleanTitle = normalizeTitle(title);
    const isEnabled = enabled === false ? false : true;
    return withUser(userId, async (client) => {
      const row = (await client.query(
        `INSERT INTO user_memories (user_id, title, content, enabled)
         VALUES (current_setting('app.current_user_id')::bigint, $1, $2, $3)
         RETURNING ${COLS}`,
        [cleanTitle, cleanContent, isEnabled]
      )).rows[0];
      return row;
    });
  }

  async patch(userId: number, id: number, { title, content, enabled }: { title?: string | null; content?: string; enabled?: boolean }) {
    return withUser(userId, async (client) => {
      const existing = (await client.query(
        `SELECT ${COLS} FROM user_memories WHERE id = $1`,
        [id]
      )).rows[0];
      if (!existing) return null;
      const nextTitle   = title   === undefined ? existing.title   : normalizeTitle(title);
      const nextContent = content === undefined ? existing.content : validateContent(content);
      const nextEnabled = enabled === undefined ? existing.enabled : Boolean(enabled);
      const row = (await client.query(
        `UPDATE user_memories
            SET title   = $2,
                content = $3,
                enabled = $4
          WHERE id = $1
          RETURNING ${COLS}`,
        [id, nextTitle, nextContent, nextEnabled]
      )).rows[0];
      return row;
    });
  }

  async delete(userId: number, id: number) {
    return withUser(userId, async (client) => {
      const existing = (await client.query(
        `SELECT ${COLS} FROM user_memories WHERE id = $1`,
        [id]
      )).rows[0];
      if (!existing) return null;
      await client.query('DELETE FROM user_memories WHERE id = $1', [id]);
      return existing;
    });
  }
}
