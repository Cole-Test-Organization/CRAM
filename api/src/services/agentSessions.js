import { randomUUID } from 'crypto';
import { withUser } from '../db/connection.js';
import { DEFAULT_PROVIDER, FALLBACK_MODEL } from '../agent/defaults.js';

const TITLE_MAX = 100;
const SNIPPET_RADIUS = 60;

// User-facing status line shown when the agent loop nudges a model that ended a
// turn with only internal reasoning (see MAX_THINKING_ONLY_NUDGES in
// agent/loop.js). Single source of truth so the live SSE `notice` event and the
// replayed-from-history `notice` event (messagesToEvents below) stay identical.
export const NUDGE_NOTICE =
  'The model replied with only reasoning and no answer — asking it to take an action or give a direct response.';

function deriveTitle(text) {
  if (!text) return null;
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned.slice(0, TITLE_MAX);
}

function stringifyToolContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === 'string') return c;
        if (c?.type === 'text') return c.text;
        return JSON.stringify(c);
      })
      .join('\n');
  }
  return JSON.stringify(content);
}

// Convert stored canonical messages → GUI event list. Symmetric to what
// the loop emits while running, so a resumed session renders identically.
export function messagesToEvents(messages) {
  const events = [];
  for (const msg of messages) {
    const content = msg.content;
    if (msg.role === 'user') {
      if (typeof content === 'string') {
        if (msg.internal) {
          // Loop-injected nudge (thinking-only guard): replayed to the model as
          // a user turn, but rendered as a notice in the transcript — matching
          // what the live SSE stream emitted, never a "You" bubble.
          events.push({ type: 'notice', level: 'nudge', message: NUDGE_NOTICE });
        } else if (content.trim()) {
          events.push({ type: 'user_prompt', text: content });
        }
      } else if (Array.isArray(content)) {
        for (const c of content) {
          if (c?.type === 'tool_result') {
            events.push({
              type: 'tool_result',
              toolUseId: c.tool_use_id,
              content: stringifyToolContent(c.content),
              isError: c.is_error === true,
            });
          } else if (c?.type === 'text' && c.text) {
            events.push({ type: 'user_prompt', text: c.text });
          }
        }
      }
    } else if (msg.role === 'assistant' && Array.isArray(content)) {
      for (const c of content) {
        if (c?.type === 'thinking' && c.thinking) {
          events.push({ type: 'thinking', text: c.thinking });
        } else if (c?.type === 'text' && c.text) {
          events.push({ type: 'assistant_text', text: c.text });
        } else if (c?.type === 'tool_use') {
          events.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
        }
      }
    }
  }
  return events;
}

export async function createSession(userId, { provider = DEFAULT_PROVIDER, model = FALLBACK_MODEL } = {}) {
  const id = randomUUID();
  return withUser(userId, async (client) => {
    await client.query(
      `INSERT INTO agent_sessions (id, user_id, provider, model)
       VALUES ($1, $2, $3, $4)`,
      [id, userId, provider, model]
    );
    return { id, userId, title: null, provider, model, messages: [] };
  });
}

export async function loadSessionRaw(userId, sessionId) {
  return withUser(userId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, title, provider, model, messages, created_at, updated_at
         FROM agent_sessions
        WHERE id = $1`,
      [sessionId]
    );
    if (rows.length === 0) {
      const err = new Error('session not found');
      err.statusCode = 404;
      throw err;
    }
    const row = rows[0];
    return {
      id: row.id,
      title: row.title,
      provider: row.provider,
      model: row.model,
      messages: row.messages || [],
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  });
}

export async function loadSession(userId, sessionId) {
  const raw = await loadSessionRaw(userId, sessionId);
  return {
    id: raw.id,
    updatedAt: raw.updatedAt,
    events: messagesToEvents(raw.messages),
  };
}

// Persist the latest messages array. If title is null on the row and a derived
// title is provided, set it (idempotent — never overwrites an existing title).
export async function saveMessages(userId, sessionId, messages, derivedTitle = null) {
  await withUser(userId, async (client) => {
    if (derivedTitle) {
      await client.query(
        `UPDATE agent_sessions
            SET messages = $1::jsonb,
                title    = COALESCE(title, $2)
          WHERE id = $3`,
        [JSON.stringify(messages), derivedTitle, sessionId]
      );
    } else {
      await client.query(
        `UPDATE agent_sessions
            SET messages = $1::jsonb
          WHERE id = $2`,
        [JSON.stringify(messages), sessionId]
      );
    }
  });
}

function buildSnippet(haystack, query) {
  if (!haystack || !query) return null;
  const lh = haystack.toLowerCase();
  const lq = query.toLowerCase();
  const idx = lh.indexOf(lq);
  if (idx < 0) return null;
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(haystack.length, idx + lq.length + SNIPPET_RADIUS);
  let before = haystack.slice(start, idx).replace(/\s+/g, ' ');
  const match = haystack.slice(idx, idx + lq.length);
  let after = haystack.slice(idx + lq.length, end).replace(/\s+/g, ' ');
  if (start > 0) before = '…' + before;
  if (end < haystack.length) after = after + '…';
  return { before, match, after };
}

export async function listSessions(userId, { limit, search } = {}) {
  const lim = typeof limit === 'number' ? Math.min(Math.max(limit, 1), 200) : 50;
  const trimmedQuery = typeof search === 'string' ? search.trim() : '';

  return withUser(userId, async (client) => {
    if (trimmedQuery) {
      const { rows } = await client.query(
        `SELECT id, title, jsonb_array_length(messages) AS message_count,
                created_at, updated_at, messages::text AS messages_text
           FROM agent_sessions
          WHERE title ILIKE $1 OR messages::text ILIKE $1
          ORDER BY updated_at DESC
          LIMIT $2`,
        [`%${trimmedQuery}%`, lim]
      );
      const { rows: countRows } = await client.query(
        `SELECT COUNT(*)::int AS c FROM agent_sessions
          WHERE title ILIKE $1 OR messages::text ILIKE $1`,
        [`%${trimmedQuery}%`]
      );
      return {
        total: countRows[0].c,
        sessions: rows.map((r) => ({
          id: r.id,
          title: r.title || '(untitled)',
          messageCount: r.message_count,
          createdAt: r.created_at.toISOString(),
          updatedAt: r.updated_at.toISOString(),
          match: buildSnippet(r.messages_text, trimmedQuery) || undefined,
        })),
      };
    }

    const { rows } = await client.query(
      `SELECT id, title, jsonb_array_length(messages) AS message_count,
              created_at, updated_at
         FROM agent_sessions
        ORDER BY updated_at DESC
        LIMIT $1`,
      [lim]
    );
    const { rows: countRows } = await client.query(
      `SELECT COUNT(*)::int AS c FROM agent_sessions`
    );
    return {
      total: countRows[0].c,
      sessions: rows.map((r) => ({
        id: r.id,
        title: r.title || '(untitled)',
        messageCount: r.message_count,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
      })),
    };
  });
}

export async function deleteSession(userId, sessionId) {
  await withUser(userId, async (client) => {
    const { rowCount } = await client.query(
      `DELETE FROM agent_sessions WHERE id = $1`,
      [sessionId]
    );
    if (rowCount === 0) {
      const err = new Error('session not found');
      err.statusCode = 404;
      throw err;
    }
  });
}

export { deriveTitle };
