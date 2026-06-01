import { withUser } from '../db/connection.js';
import { badRequest } from '../lib/http-error.js';

// Timestamped markdown notes attached to exactly one of account / contact /
// opportunity. The DB's CHECK constraint enforces the polymorphism; we just
// pass the keys through. Each entity's "notes feed" is one indexed query.

const COLS = `
  id, user_id, account_id, contact_id, opportunity_id, body, created_at, updated_at
`;

const TARGETS = ['account_id', 'contact_id', 'opportunity_id'];

function pickTarget({ account_id, contact_id, opportunity_id }) {
  const present = TARGETS
    .map((k) => [k, ({ account_id, contact_id, opportunity_id })[k]])
    .filter(([, v]) => v != null);
  if (present.length !== 1) {
    throw badRequest('Notes belong to exactly one entity — pass one of account_id, contact_id, or opportunity_id (and not more than one). Resolve the id via the accounts/contacts/opportunities tool first.');
  }
  const [key, value] = present[0];
  return { key, value: Number(value) };
}

export class NotesService {
  async getAll(userId, { account_id, contact_id, opportunity_id, limit, offset = 0 } = {}) {
    const { key, value } = pickTarget({ account_id, contact_id, opportunity_id });
    return withUser(userId, async (client) => {
      const params = [value];
      let paginationSql = '';
      if (limit != null) {
        params.push(limit, offset);
        paginationSql = `LIMIT $${params.length - 1} OFFSET $${params.length}`;
      } else if (offset) {
        params.push(offset);
        paginationSql = `OFFSET $${params.length}`;
      }
      const rows = (await client.query(
        `SELECT ${COLS}
         FROM notes
         WHERE ${key} = $1
         ORDER BY created_at DESC
         ${paginationSql}`,
        params
      )).rows;
      const total = (await client.query(
        `SELECT COUNT(*)::int AS c FROM notes WHERE ${key} = $1`,
        [value]
      )).rows[0].c;
      return { notes: rows, total };
    });
  }

  async getById(userId, id) {
    return withUser(userId, async (client) => {
      const row = (await client.query(
        `SELECT ${COLS} FROM notes WHERE id = $1`,
        [id]
      )).rows[0];
      return row || null;
    });
  }

  async create(userId, { account_id, contact_id, opportunity_id, body }) {
    const { key, value } = pickTarget({ account_id, contact_id, opportunity_id });
    return withUser(userId, async (client) => {
      const inserted = await client.query(
        `INSERT INTO notes (user_id, ${key}, body)
         VALUES (current_setting('app.current_user_id')::bigint, $1, $2)
         RETURNING ${COLS}`,
        [value, body ?? '']
      );
      return inserted.rows[0];
    });
  }

  async patch(userId, id, { body }) {
    return withUser(userId, async (client) => {
      const existing = (await client.query(
        `SELECT ${COLS} FROM notes WHERE id = $1`,
        [id]
      )).rows[0];
      if (!existing) return null;
      const newBody = body !== undefined ? body : existing.body;
      const updated = await client.query(
        `UPDATE notes SET body = $2 WHERE id = $1 RETURNING ${COLS}`,
        [id, newBody]
      );
      return updated.rows[0];
    });
  }

  async delete(userId, id) {
    return withUser(userId, async (client) => {
      const existing = (await client.query(
        `SELECT ${COLS} FROM notes WHERE id = $1`,
        [id]
      )).rows[0];
      if (!existing) return null;
      await client.query('DELETE FROM notes WHERE id = $1', [id]);
      return existing;
    });
  }
}
