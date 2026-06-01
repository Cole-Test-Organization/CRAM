import { withUser } from '../db/connection.js';
import { badRequest } from '../lib/http-error.js';

const CAT_COLS = 'id, name, created_at, updated_at';

export class ProductCategoriesService {
  async getAll(userId, { limit, offset = 0 } = {}) {
    return withUser(userId, async (client) => {
      const params = [];
      let paginationSql = '';
      if (limit != null) {
        params.push(limit, offset);
        paginationSql = `LIMIT $${params.length - 1} OFFSET $${params.length}`;
      } else if (offset) {
        params.push(offset);
        paginationSql = `OFFSET $${params.length}`;
      }
      const rows = (await client.query(
        `SELECT ${CAT_COLS},
                (SELECT COUNT(*)::int FROM products WHERE category_id = pc.id) AS product_count
         FROM product_categories pc
         ORDER BY name
         ${paginationSql}`,
        params
      )).rows;
      const total = (await client.query('SELECT COUNT(*)::int AS c FROM product_categories')).rows[0].c;
      return { categories: rows, total };
    });
  }

  async getById(userId, id) {
    return withUser(userId, async (client) => {
      const row = (await client.query(
        `SELECT ${CAT_COLS},
                (SELECT COUNT(*)::int FROM products WHERE category_id = product_categories.id) AS product_count
         FROM product_categories WHERE id = $1`,
        [id]
      )).rows[0];
      return row || null;
    });
  }

  async create(userId, { name }) {
    if (!name || !name.trim()) {
      throw badRequest('name is required (the category label, e.g. "Network", "Endpoint Security"). Categories are user-managed groupings for the per-user `products` catalog.');
    }
    return withUser(userId, async (client) => {
      const inserted = await client.query(
        `INSERT INTO product_categories (user_id, name)
         VALUES (current_setting('app.current_user_id')::bigint, $1)
         RETURNING id`,
        [name.trim()]
      );
      return this._fetch(client, inserted.rows[0].id);
    });
  }

  async patch(userId, id, { name }) {
    return withUser(userId, async (client) => {
      const existing = (await client.query(
        `SELECT ${CAT_COLS} FROM product_categories WHERE id = $1`,
        [id]
      )).rows[0];
      if (!existing) return null;

      const newName = name !== undefined ? name.trim() : existing.name;
      if (!newName) {
        throw badRequest('name cannot be empty (whitespace-only). Omit the field to leave existing name unchanged.');
      }
      await client.query(
        `UPDATE product_categories SET name = $2 WHERE id = $1`,
        [id, newName]
      );
      return this._fetch(client, id);
    });
  }

  async delete(userId, id) {
    return withUser(userId, async (client) => {
      const existing = (await client.query(
        `SELECT ${CAT_COLS} FROM product_categories WHERE id = $1`,
        [id]
      )).rows[0];
      if (!existing) return null;
      // Products with this category get their category_id set to NULL (ON DELETE SET NULL).
      await client.query('DELETE FROM product_categories WHERE id = $1', [id]);
      return existing;
    });
  }

  async _fetch(client, id) {
    return (await client.query(
      `SELECT ${CAT_COLS},
              (SELECT COUNT(*)::int FROM products WHERE category_id = product_categories.id) AS product_count
       FROM product_categories WHERE id = $1`,
      [id]
    )).rows[0] || null;
  }
}
