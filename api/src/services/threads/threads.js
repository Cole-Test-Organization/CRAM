import { withUser } from '../../db/connection.js';
import { badRequest, notFound } from '../../lib/http-error.js';

// Threads + tasks. A thread is an open workstream with exactly one customer
// account (relationship-level "where do we stand" state); a task is one
// actionable step inside a thread. The CRM owns task completion (completed_at) —
// there is deliberately no Todoist link yet. thread_contacts is the pool of
// people involved in a thread, distinct from any single task's assignee
// (assignee is nullable; NULL = "no one", never auto-assigned to the user).
//
// Lifecycle: closed_at (NULL = open) on threads, completed_at (NULL = open) on
// tasks. Lists default to open-only; pass include_closed / include_completed to
// see the rest. One service owns all three tables because they're edited
// together inside a single account's view (the way AccountsService owns partners).

const THREAD_COLS = `id, user_id, account_id, title, description, closed_at, created_at, updated_at`;
const TASK_COLS = `id, user_id, thread_id, assignee_contact_id, title, description, due_date, completed_at, created_at, updated_at`;

export class ThreadsService {
  // ── threads ───────────────────────────────────────────────────────────────

  async getAllForAccount(userId, accountId, { include_closed = false } = {}) {
    const id = Number(accountId);
    if (!Number.isInteger(id)) {
      throw badRequest(`account_id must be an integer (got "${accountId}"). Resolve the account via the accounts/search tool first.`);
    }
    return withUser(userId, async (client) => {
      const threads = (await client.query(
        `SELECT ${THREAD_COLS}
           FROM threads
          WHERE account_id = $1
            ${include_closed ? '' : 'AND closed_at IS NULL'}
          ORDER BY (closed_at IS NULL) DESC, created_at DESC`,
        [id]
      )).rows;
      await this._enrich(client, threads);
      return { threads, total: threads.length };
    });
  }

  async getById(userId, id) {
    return withUser(userId, (client) => this._fetch(client, id));
  }

  async create(userId, { account_id, title, description, contact_ids } = {}) {
    if (account_id == null) throw badRequest('account_id is required to create a thread.');
    if (!title || !String(title).trim()) throw badRequest('title is required to create a thread.');
    return withUser(userId, async (client) => {
      let inserted;
      try {
        inserted = await client.query(
          `INSERT INTO threads (user_id, account_id, title, description)
           VALUES (current_setting('app.current_user_id')::bigint, $1, $2, $3)
           RETURNING ${THREAD_COLS}`,
          [Number(account_id), String(title).trim(), description ?? null]
        );
      } catch (err) {
        if (err.code === '23503') throw notFound(`Account ${account_id} not found.`);
        throw err;
      }
      const thread = inserted.rows[0];
      // Seed the contact pool, ignoring ids the caller can't see (RLS-scoped) so
      // a stray id never aborts thread creation.
      if (Array.isArray(contact_ids) && contact_ids.length) {
        const visible = (await client.query(
          `SELECT id FROM contacts WHERE id = ANY($1::bigint[])`,
          [contact_ids.map(Number)]
        )).rows.map((r) => r.id);
        for (const cid of visible) {
          await client.query(
            `INSERT INTO thread_contacts (thread_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [thread.id, cid]
          );
        }
      }
      return this._fetch(client, thread.id);
    });
  }

  // PATCH merge: only fields present are changed. `closed` is a convenience
  // boolean — true closes (preserving an existing close time), false reopens.
  async patch(userId, id, data = {}) {
    if (data.title !== undefined && !String(data.title).trim()) {
      throw badRequest('thread title cannot be blank.');
    }
    return withUser(userId, async (client) => {
      const existing = (await client.query(`SELECT ${THREAD_COLS} FROM threads WHERE id = $1`, [id])).rows[0];
      if (!existing) return null;
      const title = data.title !== undefined ? String(data.title).trim() : existing.title;
      const description = data.description !== undefined ? data.description : existing.description;
      await client.query(
        `UPDATE threads SET
           title = $2,
           description = $3,
           closed_at = CASE WHEN $4::boolean IS TRUE  THEN COALESCE(closed_at, NOW())
                            WHEN $4::boolean IS FALSE THEN NULL
                            ELSE closed_at END
         WHERE id = $1`,
        [id, title, description, data.closed === undefined ? null : !!data.closed]
      );
      return this._fetch(client, id);
    });
  }

  async delete(userId, id) {
    return withUser(userId, async (client) => {
      const existing = (await client.query(`SELECT ${THREAD_COLS} FROM threads WHERE id = $1`, [id])).rows[0];
      if (!existing) return null;
      // Cascades tasks + thread_contacts via FK ON DELETE CASCADE.
      await client.query('DELETE FROM threads WHERE id = $1', [id]);
      return existing;
    });
  }

  // ── tasks ─────────────────────────────────────────────────────────────────

  async createTask(userId, threadId, { title, description, assignee_contact_id, due_date } = {}) {
    if (!title || !String(title).trim()) throw badRequest('title is required to create a task.');
    return withUser(userId, async (client) => {
      const thread = (await client.query('SELECT id FROM threads WHERE id = $1', [threadId])).rows[0];
      if (!thread) throw notFound(`Thread ${threadId} not found.`);
      if (assignee_contact_id != null) await this._assertContactVisible(client, assignee_contact_id);
      const inserted = await client.query(
        `INSERT INTO tasks (user_id, thread_id, assignee_contact_id, title, description, due_date)
         VALUES (current_setting('app.current_user_id')::bigint, $1, $2, $3, $4, $5)
         RETURNING ${TASK_COLS}`,
        [
          Number(threadId),
          assignee_contact_id != null ? Number(assignee_contact_id) : null,
          String(title).trim(),
          description ?? null,
          due_date || null,
        ]
      );
      return this._taskWithAssignee(client, inserted.rows[0]);
    });
  }

  // PATCH merge. `assignee_contact_id: null` clears the assignee ("no one").
  // `completed` true/false toggles completed_at.
  async patchTask(userId, taskId, data = {}) {
    if (data.title !== undefined && !String(data.title).trim()) {
      throw badRequest('task title cannot be blank.');
    }
    return withUser(userId, async (client) => {
      const existing = (await client.query(`SELECT ${TASK_COLS} FROM tasks WHERE id = $1`, [taskId])).rows[0];
      if (!existing) return null;
      if (
        data.assignee_contact_id != null &&
        Number(data.assignee_contact_id) !== Number(existing.assignee_contact_id)
      ) {
        await this._assertContactVisible(client, data.assignee_contact_id);
      }
      const title = data.title !== undefined ? String(data.title).trim() : existing.title;
      const description = data.description !== undefined ? data.description : existing.description;
      const assignee = data.assignee_contact_id !== undefined
        ? (data.assignee_contact_id == null ? null : Number(data.assignee_contact_id))
        : existing.assignee_contact_id;
      const due = data.due_date !== undefined ? (data.due_date || null) : existing.due_date;
      const updated = await client.query(
        `UPDATE tasks SET
           title = $2,
           description = $3,
           assignee_contact_id = $4,
           due_date = $5,
           completed_at = CASE WHEN $6::boolean IS TRUE  THEN COALESCE(completed_at, NOW())
                               WHEN $6::boolean IS FALSE THEN NULL
                               ELSE completed_at END
         WHERE id = $1
         RETURNING ${TASK_COLS}`,
        [taskId, title, description, assignee, due, data.completed === undefined ? null : !!data.completed]
      );
      return this._taskWithAssignee(client, updated.rows[0]);
    });
  }

  async deleteTask(userId, taskId) {
    return withUser(userId, async (client) => {
      const existing = (await client.query(`SELECT ${TASK_COLS} FROM tasks WHERE id = $1`, [taskId])).rows[0];
      if (!existing) return null;
      await client.query('DELETE FROM tasks WHERE id = $1', [taskId]);
      return existing;
    });
  }

  // ── thread contacts (the involved-people pool) ──────────────────────────────

  async linkContact(userId, threadId, contactId) {
    return withUser(userId, async (client) => {
      const thread = (await client.query('SELECT id FROM threads WHERE id = $1', [threadId])).rows[0];
      if (!thread) throw notFound(`Thread ${threadId} not found.`);
      await this._assertContactVisible(client, contactId);
      await client.query(
        `INSERT INTO thread_contacts (thread_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [Number(threadId), Number(contactId)]
      );
      return this._fetch(client, threadId);
    });
  }

  async unlinkContact(userId, threadId, contactId) {
    return withUser(userId, async (client) => {
      const thread = (await client.query('SELECT id FROM threads WHERE id = $1', [threadId])).rows[0];
      if (!thread) throw notFound(`Thread ${threadId} not found.`);
      // Note: deliberately does NOT clear tasks assigned to this contact — the
      // pool is "who's involved", an assignee can outlive pool membership.
      await client.query(
        'DELETE FROM thread_contacts WHERE thread_id = $1 AND contact_id = $2',
        [Number(threadId), Number(contactId)]
      );
      return this._fetch(client, threadId);
    });
  }

  // ── helpers ─────────────────────────────────────────────────────────────────

  // Fetch one thread enriched with its tasks + contact pool, or null.
  async _fetch(client, id) {
    const thread = (await client.query(`SELECT ${THREAD_COLS} FROM threads WHERE id = $1`, [id])).rows[0];
    if (!thread) return null;
    await this._enrich(client, [thread]);
    return thread;
  }

  // Attach tasks[] (open first, then by due date) and contacts[] (the pool) to a
  // set of thread rows in two batched queries — no N+1.
  async _enrich(client, threads) {
    if (!threads.length) return threads;
    const ids = threads.map((t) => t.id);

    const tasks = (await client.query(
      `SELECT t.id, t.user_id, t.thread_id, t.assignee_contact_id, t.title, t.description,
              t.due_date, t.completed_at, t.created_at, t.updated_at,
              c.full_name AS assignee_full_name
         FROM tasks t
         LEFT JOIN contacts c ON c.id = t.assignee_contact_id
        WHERE t.thread_id = ANY($1::bigint[])
        ORDER BY (t.completed_at IS NULL) DESC, t.due_date ASC NULLS LAST, t.created_at ASC`,
      [ids]
    )).rows;

    const contacts = (await client.query(
      `SELECT tc.thread_id, c.id, c.full_name, c.company, c.title, c.email, c.kind
         FROM thread_contacts tc
         JOIN contacts c ON c.id = tc.contact_id
        WHERE tc.thread_id = ANY($1::bigint[])
        ORDER BY c.full_name`,
      [ids]
    )).rows;

    const tasksByThread = new Map();
    for (const row of tasks) {
      const list = tasksByThread.get(row.thread_id) || [];
      list.push(row);
      tasksByThread.set(row.thread_id, list);
    }
    const contactsByThread = new Map();
    for (const { thread_id, ...c } of contacts) {
      const list = contactsByThread.get(thread_id) || [];
      list.push(c);
      contactsByThread.set(thread_id, list);
    }
    for (const t of threads) {
      t.tasks = tasksByThread.get(t.id) || [];
      t.contacts = contactsByThread.get(t.id) || [];
    }
    return threads;
  }

  // RLS-scoped existence check: only sees the current user's contacts, so it
  // doubles as a tenant-isolation guard on assignee ids.
  async _assertContactVisible(client, contactId) {
    const row = (await client.query('SELECT id FROM contacts WHERE id = $1', [Number(contactId)])).rows[0];
    if (!row) throw badRequest(`Contact ${contactId} not found — can't use it as an assignee.`);
  }

  async _taskWithAssignee(client, task) {
    if (!task) return task;
    if (task.assignee_contact_id == null) {
      task.assignee_full_name = null;
      return task;
    }
    const row = (await client.query('SELECT full_name FROM contacts WHERE id = $1', [task.assignee_contact_id])).rows[0];
    task.assignee_full_name = row ? row.full_name : null;
    return task;
  }
}
