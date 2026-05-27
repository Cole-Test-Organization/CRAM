import { withUser } from '../db/connection.js';

// Columns kept in lock-step with the migration. Scalar columns are upsertable
// individually via PATCH; array columns are fully replaced on each PATCH (no
// item-level diffing — the caller sends the full intended array).
const SCALAR_COLS = [
  'industry', 'revenue_usd', 'employee_count', 'user_count',
  'endpoint_count', 'server_count', 'site_count', 'dc_count',
  'hq_city', 'hq_state', 'hq_country',
  'it_team_size', 'security_team_size',
  'soc_model', 'has_ot_environment', 'has_iot_environment',
  'technical_notes', 'last_verified_at',
];

const ARRAY_COLS = [
  'compliance_frameworks',
  'firewall_ids', 'edr_ids', 'siem_ids', 'idp_ids', 'mfa_ids', 'pam_ids',
  'email_security_ids', 'mdr_ids', 'msp_ids', 'sase_ids', 'sdwan_ids',
  'vpn_ids', 'dlp_ids', 'casb_ids', 'vuln_mgmt_ids', 'ticketing_ids',
  'productivity_suite_ids', 'cloud_provider_ids',
  'cspm_ids', 'appsec_ids', 'ndr_ids', 'iot_ot_ids', 'ai_security_ids',
];

const VENDOR_ARRAY_COLS = ARRAY_COLS.filter((c) => c.endsWith('_ids'));

const ALL_COLS = ['account_id', ...SCALAR_COLS, ...ARRAY_COLS, 'created_at', 'updated_at'];

export class AccountDetailsService {
  async getByAccountId(userId, accountId) {
    return withUser(userId, async (client) => {
      const row = (await client.query(
        `SELECT ${ALL_COLS.join(', ')} FROM account_details WHERE account_id = $1`,
        [accountId]
      )).rows[0];
      if (!row) return null;
      return this._expandVendorProducts(client, row);
    });
  }

  // PATCH-style upsert. Scalar fields are only touched when present in `data`;
  // array fields are fully replaced when present (pass [] to clear). If the
  // account_details row doesn't exist yet, it's created.
  async upsert(userId, accountId, data) {
    return withUser(userId, async (client) => {
      // Confirm the account exists and the caller can see it (RLS applies).
      const account = (await client.query('SELECT id FROM accounts WHERE id = $1', [accountId])).rows[0];
      if (!account) {
        throw Object.assign(new Error(`Account not found: ${accountId}`), { statusCode: 404 });
      }

      const existing = (await client.query(
        `SELECT ${ALL_COLS.join(', ')} FROM account_details WHERE account_id = $1`,
        [accountId]
      )).rows[0];

      // Build the column list to write based on what's in `data`.
      const touched = {};
      for (const col of SCALAR_COLS) {
        if (data[col] !== undefined) touched[col] = data[col];
      }
      for (const col of ARRAY_COLS) {
        if (data[col] !== undefined) {
          if (!Array.isArray(data[col])) {
            throw Object.assign(new Error(`${col} must be an array of vendor_product ids (numeric). Pass [] to clear, or omit to leave alone. Find vendor_product ids via the vendor_products tool (action="list" filtered by category, or action="find_or_create" if you need to add one).`), { statusCode: 400 });
          }
          touched[col] = data[col];
        }
      }

      if (!existing) {
        // INSERT path — fill anything not provided with NULL/default.
        const insertCols = ['account_id', ...Object.keys(touched)];
        const insertVals = [accountId, ...Object.keys(touched).map((c) => touched[c])];
        const placeholders = insertVals.map((_, i) => `$${i + 1}`).join(', ');
        await client.query(
          `INSERT INTO account_details (${insertCols.join(', ')}) VALUES (${placeholders})`,
          insertVals
        );
      } else if (Object.keys(touched).length > 0) {
        // UPDATE path — only the columns the caller sent.
        const setClauses = [];
        const params = [accountId];
        for (const [col, val] of Object.entries(touched)) {
          params.push(val);
          setClauses.push(`${col} = $${params.length}`);
        }
        await client.query(
          `UPDATE account_details SET ${setClauses.join(', ')} WHERE account_id = $1`,
          params
        );
      }

      const fresh = (await client.query(
        `SELECT ${ALL_COLS.join(', ')} FROM account_details WHERE account_id = $1`,
        [accountId]
      )).rows[0];
      return this._expandVendorProducts(client, fresh);
    });
  }

  async delete(userId, accountId) {
    return withUser(userId, async (client) => {
      const deleted = await client.query(
        `DELETE FROM account_details WHERE account_id = $1 RETURNING account_id`,
        [accountId]
      );
      return deleted.rows[0] || null;
    });
  }

  // Replace each *_ids array on the row with a list of expanded product
  // objects ({ id, name, vendor_id, vendor_name, vendor_slug, category })
  // for the GUI/agent. Skips a JOIN when all arrays are empty.
  async _expandVendorProducts(client, row) {
    const allIds = new Set();
    for (const col of VENDOR_ARRAY_COLS) {
      for (const id of row[col] || []) allIds.add(Number(id));
    }
    if (allIds.size === 0) {
      const expanded = { ...row };
      for (const col of VENDOR_ARRAY_COLS) {
        const key = col.replace(/_ids$/, '_products');
        expanded[key] = [];
      }
      return expanded;
    }
    const products = (await client.query(
      `SELECT vp.id, vp.name, vp.category, vp.deleted_at, vp.vendor_id,
              v.name AS vendor_name, v.slug AS vendor_slug
       FROM vendor_products vp
       JOIN vendors v ON v.id = vp.vendor_id
       WHERE vp.id = ANY($1::bigint[])`,
      [[...allIds]]
    )).rows;
    const byId = new Map(products.map((p) => [Number(p.id), p]));
    const expanded = { ...row };
    for (const col of VENDOR_ARRAY_COLS) {
      const key = col.replace(/_ids$/, '_products');
      expanded[key] = (row[col] || []).map((id) => byId.get(Number(id))).filter(Boolean);
    }
    return expanded;
  }
}
