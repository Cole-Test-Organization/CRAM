import { withUser } from '../../db/connection.js';
import { badRequest, notFound } from '../../lib/http-error.js';

const OPP_COLS = `
  id, account_id, name, opp_link, trr_link, tech_validation_link, stage, notes,
  why_change, why_now, why_us,
  created_at, updated_at
`;

const VALID_STAGES = new Set([
  'opp_identification',
  'tech_discovery',
  'non_pov_tech_validation',
  'pov_planning',
  'pov_tech_validation',
  'tech_decision_pending',
  'tech_loss_closed',
  'tech_win_closed',
  'no_tech_validation_closed',
]);

function normalizeStage(stage) {
  if (stage == null) return undefined;
  if (!VALID_STAGES.has(stage)) {
    throw badRequest(`Invalid stage: ${stage}. Must be one of: ${[...VALID_STAGES].join(', ')}`);
  }
  return stage;
}

function normalizeReasonList(value, field) {
  if (value === undefined) return undefined;
  if (value === null) return [];
  if (!Array.isArray(value)) {
    throw badRequest(`${field} must be an array of strings`);
  }
  return value
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter((v) => v.length > 0);
}

export class OpportunitiesService {
  async getAll(userId, { account_id, stage, sort = 'created_at', order = 'desc', limit = 100, offset = 0 } = {}) {
    return withUser(userId, async (client) => {
      const validSorts = ['name', 'stage', 'created_at', 'updated_at'];
      const sortCol = validSorts.includes(sort) ? sort : 'created_at';
      const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

      const params = [];
      const conditions = [];
      if (account_id) {
        params.push(account_id);
        conditions.push(`o.account_id = $${params.length}`);
      }
      if (stage) {
        params.push(normalizeStage(stage));
        conditions.push(`o.stage = $${params.length}`);
      }
      const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
      params.push(limit, offset);

      const rows = (await client.query(
        `SELECT o.id, o.account_id, o.name, o.opp_link, o.trr_link, o.tech_validation_link,
                o.stage, o.notes, o.why_change, o.why_now, o.why_us,
                o.created_at, o.updated_at,
                a.name AS account_name, a.slug AS account_slug,
                (SELECT COUNT(*)::int FROM opp_products WHERE opportunity_id = o.id) AS product_count
         FROM opportunities o
         JOIN accounts a ON a.id = o.account_id
         ${whereClause}
         ORDER BY o.${sortCol} ${sortOrder}
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      )).rows;

      const countRes = account_id
        ? await client.query('SELECT COUNT(*)::int AS c FROM opportunities WHERE account_id = $1', [account_id])
        : await client.query('SELECT COUNT(*)::int AS c FROM opportunities');
      return { opportunities: rows, total: countRes.rows[0].c };
    });
  }

  async getById(userId, id) {
    return withUser(userId, (client) => this._fetchWithProducts(client, id));
  }

  async getByAccount(userId, accountId) {
    return withUser(userId, async (client) => {
      const rows = (await client.query(
        `SELECT ${OPP_COLS},
                (SELECT COUNT(*)::int FROM opp_products WHERE opportunity_id = opportunities.id) AS product_count
         FROM opportunities
         WHERE account_id = $1
         ORDER BY created_at DESC`,
        [accountId]
      )).rows;
      return rows;
    });
  }

  async create(userId, data) {
    if (!data?.account_id) {
      throw badRequest('account_id is required (the numeric id of the account this deal is on). Resolve via the accounts tool — list/search/get. The account must NOT be status="partner" — opps live on customer accounts only.');
    }
    if (!data?.name?.trim()) {
      throw badRequest('name is required (the deal name, e.g. "Q3 EDR Refresh").');
    }
    return withUser(userId, async (client) => {
      await this._assertNotPartnerAccount(client, data.account_id);

      const stage = normalizeStage(data.stage) || 'opp_identification';
      const whyChange = normalizeReasonList(data.why_change, 'why_change') ?? [];
      const whyNow    = normalizeReasonList(data.why_now,    'why_now')    ?? [];
      const whyUs     = normalizeReasonList(data.why_us,     'why_us')     ?? [];

      const inserted = await client.query(
        `INSERT INTO opportunities (
           user_id, account_id, name, opp_link, trr_link, tech_validation_link, stage, notes,
           why_change, why_now, why_us
         ) VALUES (
           current_setting('app.current_user_id')::bigint,
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
         ) RETURNING id`,
        [
          data.account_id,
          data.name.trim(),
          data.opp_link || null,
          data.trr_link || null,
          data.tech_validation_link || null,
          stage,
          data.notes || null,
          whyChange,
          whyNow,
          whyUs,
        ]
      );
      const oppId = inserted.rows[0].id;

      if (Array.isArray(data.product_ids) && data.product_ids.length > 0) {
        await this._setProducts(client, oppId, data.product_ids);
      }
      return this._fetchWithProducts(client, oppId);
    });
  }

  async patch(userId, id, data) {
    return withUser(userId, async (client) => {
      const existing = (await client.query(
        `SELECT ${OPP_COLS} FROM opportunities WHERE id = $1`,
        [id]
      )).rows[0];
      if (!existing) return null;

      const nextAccountId = data.account_id !== undefined ? data.account_id : existing.account_id;
      if (data.account_id !== undefined && data.account_id !== existing.account_id) {
        await this._assertNotPartnerAccount(client, nextAccountId);
      }

      const nextWhyChange = normalizeReasonList(data.why_change, 'why_change');
      const nextWhyNow    = normalizeReasonList(data.why_now,    'why_now');
      const nextWhyUs     = normalizeReasonList(data.why_us,     'why_us');

      const next = {
        account_id: nextAccountId,
        name: data.name !== undefined ? (data.name?.trim() || existing.name) : existing.name,
        opp_link: data.opp_link !== undefined ? data.opp_link : existing.opp_link,
        trr_link: data.trr_link !== undefined ? data.trr_link : existing.trr_link,
        tech_validation_link: data.tech_validation_link !== undefined ? data.tech_validation_link : existing.tech_validation_link,
        stage: data.stage !== undefined ? normalizeStage(data.stage) : existing.stage,
        notes: data.notes !== undefined ? data.notes : existing.notes,
        why_change: nextWhyChange !== undefined ? nextWhyChange : existing.why_change,
        why_now:    nextWhyNow    !== undefined ? nextWhyNow    : existing.why_now,
        why_us:     nextWhyUs     !== undefined ? nextWhyUs     : existing.why_us,
      };
      if (!next.name) {
        throw badRequest('name cannot be empty');
      }

      await client.query(
        `UPDATE opportunities SET
           account_id = $2, name = $3, opp_link = $4,
           trr_link = $5, tech_validation_link = $6, stage = $7, notes = $8,
           why_change = $9, why_now = $10, why_us = $11
         WHERE id = $1`,
        [
          id,
          next.account_id,
          next.name,
          next.opp_link || null,
          next.trr_link || null,
          next.tech_validation_link || null,
          next.stage,
          next.notes || null,
          next.why_change,
          next.why_now,
          next.why_us,
        ]
      );

      if (data.product_ids !== undefined) {
        await this._setProducts(client, id, data.product_ids || []);
      }
      return this._fetchWithProducts(client, id);
    });
  }

  async delete(userId, id) {
    return withUser(userId, async (client) => {
      const existing = (await client.query(
        `SELECT ${OPP_COLS} FROM opportunities WHERE id = $1`,
        [id]
      )).rows[0];
      if (!existing) return null;
      await client.query('DELETE FROM opportunities WHERE id = $1', [id]);
      return existing;
    });
  }

  async linkProduct(userId, opportunityId, productId) {
    return withUser(userId, async (client) => {
      const opp = (await client.query('SELECT id FROM opportunities WHERE id = $1', [opportunityId])).rows[0];
      if (!opp) return null;
      const product = (await client.query('SELECT id FROM products WHERE id = $1', [productId])).rows[0];
      if (!product) {
        throw notFound(`Product not found: id=${productId}. Opportunity product_ids reference rows from the per-user \`products\` tool (what you sell). If you passed an id from \`vendor_products\` (the global catalog of what accounts run), that is a different namespace and will not link — use products.list with search instead.`);
      }
      await client.query(
        'INSERT INTO opp_products (opportunity_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [opportunityId, productId]
      );
      return this._fetchWithProducts(client, opportunityId);
    });
  }

  async unlinkProduct(userId, opportunityId, productId) {
    return withUser(userId, async (client) => {
      const opp = (await client.query('SELECT id FROM opportunities WHERE id = $1', [opportunityId])).rows[0];
      if (!opp) return null;
      await client.query(
        'DELETE FROM opp_products WHERE opportunity_id = $1 AND product_id = $2',
        [opportunityId, productId]
      );
      return this._fetchWithProducts(client, opportunityId);
    });
  }

  async _assertNotPartnerAccount(client, accountId) {
    const row = (await client.query(
      'SELECT id, status FROM accounts WHERE id = $1',
      [accountId]
    )).rows[0];
    if (!row) {
      throw notFound(`Account not found: id=${accountId}. Use the accounts tool — action="list" for slugs, action="get" with slug/domain, or the search tool (type="accounts") for fuzzy name match.`);
    }
    if (row.status === 'partner') {
      throw badRequest(`Account ${accountId} is a partner account (status="partner"). Opportunities live on customer accounts you sell TO, not partner accounts you sell WITH. Pick a different account, or change this account's status if it is misclassified.`);
    }
  }

  async _setProducts(client, opportunityId, productIds) {
    const ids = [...new Set(productIds.map(Number).filter((n) => Number.isInteger(n)))];
    if (ids.length > 0) {
      const valid = (await client.query(
        'SELECT id FROM products WHERE id = ANY($1::bigint[])',
        [ids]
      )).rows.map((r) => Number(r.id));
      const missing = ids.filter((id) => !valid.includes(id));
      if (missing.length) {
        throw badRequest(`Product(s) not found: ${missing.join(', ')}. Opportunity product_ids reference rows from the per-user \`products\` tool. If you passed ids from \`vendor_products\` (the global tech-stack catalog), that is a different namespace — use products.list with search to find the right ids.`);
      }
    }
    await client.query('DELETE FROM opp_products WHERE opportunity_id = $1', [opportunityId]);
    for (const productId of ids) {
      await client.query(
        'INSERT INTO opp_products (opportunity_id, product_id) VALUES ($1, $2)',
        [opportunityId, productId]
      );
    }
  }

  async _fetchWithProducts(client, id) {
    const opp = (await client.query(
      `SELECT o.id, o.account_id, o.name, o.opp_link, o.trr_link, o.tech_validation_link,
              o.stage, o.notes, o.why_change, o.why_now, o.why_us,
              o.created_at, o.updated_at,
              a.name AS account_name, a.slug AS account_slug
       FROM opportunities o
       JOIN accounts a ON a.id = o.account_id
       WHERE o.id = $1`,
      [id]
    )).rows[0];
    if (!opp) return null;

    const products = (await client.query(
      `SELECT p.id, p.name, p.category_id, pc.name AS category_name
       FROM opp_products op
       JOIN products p ON p.id = op.product_id
       LEFT JOIN product_categories pc ON pc.id = p.category_id
       WHERE op.opportunity_id = $1
       ORDER BY p.name`,
      [id]
    )).rows;

    return { ...opp, products };
  }
}
