import type { PoolClient } from 'pg';
import { withUser } from '../../db/connection.js';
import { badRequest } from '../../lib/http-error.js';

const PRODUCT_COLS = 'id, name, category_id, created_at, updated_at';

const SELECT_WITH_CATEGORY = `
  SELECT p.id, p.name, p.category_id, p.created_at, p.updated_at,
         pc.name AS category_name
  FROM products p
  LEFT JOIN product_categories pc ON pc.id = p.category_id
`;

export class ProductsService {
  async getAll(userId: number, { category_id, search, limit, offset = 0 }: { category_id?: number | null; search?: string; limit?: number | null; offset?: number } = {}) {
    return withUser(userId, async (client) => {
      const params = [];
      const conditions = [];
      if (category_id) {
        params.push(category_id);
        conditions.push(`p.category_id = $${params.length}`);
      }
      if (search) {
        params.push(`%${search}%`);
        conditions.push(`p.name ILIKE $${params.length}`);
      }
      const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
      let paginationSql = '';
      if (limit != null) {
        params.push(limit, offset);
        paginationSql = `LIMIT $${params.length - 1} OFFSET $${params.length}`;
      } else if (offset) {
        params.push(offset);
        paginationSql = `OFFSET $${params.length}`;
      }

      const rows = (await client.query(
        `${SELECT_WITH_CATEGORY}
         ${whereClause}
         ORDER BY p.name
         ${paginationSql}`,
        params
      )).rows;

      const totalRes = category_id
        ? await client.query('SELECT COUNT(*)::int AS c FROM products WHERE category_id = $1', [category_id])
        : await client.query('SELECT COUNT(*)::int AS c FROM products');
      return { products: rows, total: totalRes.rows[0].c };
    });
  }

  async getById(userId: number, id: number) {
    return withUser(userId, async (client) => {
      const row = (await client.query(
        `${SELECT_WITH_CATEGORY} WHERE p.id = $1`,
        [id]
      )).rows[0];
      return row || null;
    });
  }

  async create(userId: number, { name, category_id }: { name?: string; category_id?: number | null }) {
    if (!name || !name.trim()) {
      throw badRequest('name is required (the product name as you sell it, e.g. "PA-Series Firewalls"). This is the per-user catalog of what YOU SELL — for products that accounts RUN (tech stack tracking), use the vendor_products tool instead.');
    }
    return withUser(userId, async (client) => {
      if (category_id != null) await this._assertCategory(client, category_id);
      const inserted = await client.query(
        `INSERT INTO products (user_id, name, category_id)
         VALUES (current_setting('app.current_user_id')::bigint, $1, $2)
         RETURNING id`,
        [name.trim(), category_id || null]
      );
      return this._fetch(client, inserted.rows[0].id);
    });
  }

  async patch(userId: number, id: number, data: { name?: string; category_id?: number | null }) {
    return withUser(userId, async (client) => {
      const existing = (await client.query(
        `SELECT ${PRODUCT_COLS} FROM products WHERE id = $1`,
        [id]
      )).rows[0];
      if (!existing) return null;

      const next = {
        name: data.name !== undefined ? (data.name?.trim() || existing.name) : existing.name,
        category_id: data.category_id !== undefined ? data.category_id : existing.category_id,
      };
      if (!next.name) {
        throw badRequest('name cannot be empty (whitespace-only). Omit the field to leave existing name unchanged, or supply a non-empty string.');
      }
      if (next.category_id != null && next.category_id !== existing.category_id) {
        await this._assertCategory(client, next.category_id);
      }
      await client.query(
        `UPDATE products SET name = $2, category_id = $3 WHERE id = $1`,
        [id, next.name, next.category_id || null]
      );
      return this._fetch(client, id);
    });
  }

  async delete(userId: number, id: number) {
    return withUser(userId, async (client) => {
      const existing = (await client.query(
        `SELECT ${PRODUCT_COLS} FROM products WHERE id = $1`,
        [id]
      )).rows[0];
      if (!existing) return null;
      await client.query('DELETE FROM products WHERE id = $1', [id]);
      return existing;
    });
  }

  async _fetch(client: PoolClient, id: number) {
    return (await client.query(`${SELECT_WITH_CATEGORY} WHERE p.id = $1`, [id])).rows[0] || null;
  }

  async _assertCategory(client: PoolClient, categoryId: number) {
    const row = (await client.query('SELECT id FROM product_categories WHERE id = $1', [categoryId])).rows[0];
    if (!row) {
      throw badRequest(`Product category not found: id=${categoryId}. Use the product_categories tool (action="list") to find valid ids, or "create" if you need a new one.`);
    }
  }
}
