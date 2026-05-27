import { withUser } from '../db/connection.js';

// 5 portfolio buckets, each with the fine-grained account_details *_ids
// columns that fall under it. The bucket is the section header in the GUI;
// each `subcategory` becomes a column under that header. Labels here are the
// canonical short-form names — they're returned in the API response so the
// GUI doesn't have to keep its own copy of the mapping.
//
// Some lower-level categories (`productivity_suite`, `ticketing`) aren't a
// clean fit for any bucket and are intentionally omitted from this view.
// They remain trackable on the technical profile.
export const HEATMAP_BUCKETS = [
  {
    key: 'ai_security', label: 'AI Security',
    subcategories: [
      { key: 'ai_security', label: 'AI Security', column: 'ai_security_ids' },
    ],
  },
  {
    key: 'cloud', label: 'Cloud',
    subcategories: [
      { key: 'cloud_provider', label: 'Cloud Provider', column: 'cloud_provider_ids' },
      { key: 'cspm',           label: 'CSPM',           column: 'cspm_ids' },
      { key: 'casb',           label: 'CASB',           column: 'casb_ids' },
      { key: 'appsec',         label: 'AppSec',         column: 'appsec_ids' },
    ],
  },
  {
    key: 'identity', label: 'Identity',
    subcategories: [
      { key: 'idp', label: 'Identity Provider', column: 'idp_ids' },
      { key: 'mfa', label: 'MFA',               column: 'mfa_ids' },
      { key: 'pam', label: 'PAM',               column: 'pam_ids' },
    ],
  },
  {
    key: 'network', label: 'Network',
    subcategories: [
      { key: 'firewall', label: 'Firewall', column: 'firewall_ids' },
      { key: 'sase',     label: 'SASE',     column: 'sase_ids' },
      { key: 'sdwan',    label: 'SD-WAN',   column: 'sdwan_ids' },
      { key: 'vpn',      label: 'VPN',      column: 'vpn_ids' },
      { key: 'ndr',      label: 'NDR',      column: 'ndr_ids' },
      { key: 'iot_ot',   label: 'OT / IoT', column: 'iot_ot_ids' },
    ],
  },
  {
    key: 'soc', label: 'SOC',
    subcategories: [
      { key: 'edr',            label: 'EDR',            column: 'edr_ids' },
      { key: 'siem',           label: 'SIEM',           column: 'siem_ids' },
      { key: 'mdr',            label: 'MDR',            column: 'mdr_ids' },
      { key: 'msp',            label: 'MSP',            column: 'msp_ids' },
      { key: 'email_security', label: 'Email Security', column: 'email_security_ids' },
      { key: 'dlp',            label: 'DLP',            column: 'dlp_ids' },
      { key: 'vuln_mgmt',      label: 'Vuln Mgmt',      column: 'vuln_mgmt_ids' },
    ],
  },
];

// Flat list of every account_details column the heatmap reads from — used to
// build the SELECT.
const HEATMAP_COLS = HEATMAP_BUCKETS.flatMap((b) => b.subcategories.map((s) => s.column));

export class VendorHeatmapService {
  // Returns a buckets→subcategories→products matrix. Each subcategory carries
  // the products the account runs in that fine-grained category (typically
  // 0, 1, or 2 products). Empty subcategories are still included so the GUI
  // can render the column with a "no solution" placeholder.
  async getByAccountId(userId, accountId) {
    return withUser(userId, async (client) => {
      const row = (await client.query(
        `SELECT account_id, ${HEATMAP_COLS.join(', ')}
         FROM account_details WHERE account_id = $1`,
        [accountId]
      )).rows[0];
      const shellBuckets = HEATMAP_BUCKETS.map((b) => ({
        key: b.key,
        label: b.label,
        subcategories: b.subcategories.map((s) => ({ key: s.key, label: s.label, products: [] })),
      }));
      const emptyResponse = { account_id: Number(accountId), buckets: shellBuckets };
      if (!row) return emptyResponse;

      const allIds = new Set();
      for (const col of HEATMAP_COLS) {
        for (const id of row[col] || []) allIds.add(Number(id));
      }
      if (allIds.size === 0) return emptyResponse;

      const products = (await client.query(
        `SELECT vp.id, vp.name, vp.category, vp.vendor_id,
                v.name AS vendor_name, v.slug AS vendor_slug
         FROM vendor_products vp
         JOIN vendors v ON v.id = vp.vendor_id
         WHERE vp.id = ANY($1::bigint[])`,
        [[...allIds]]
      )).rows;
      const byId = new Map(products.map((p) => [Number(p.id), p]));

      const buckets = HEATMAP_BUCKETS.map((bucket) => ({
        key: bucket.key,
        label: bucket.label,
        subcategories: bucket.subcategories.map((sub) => {
          // De-dupe in case the same product id ended up in the array twice.
          const seen = new Set();
          const cellProducts = [];
          for (const rawId of row[sub.column] || []) {
            const id = Number(rawId);
            if (seen.has(id)) continue;
            const p = byId.get(id);
            if (!p) continue;
            seen.add(id);
            cellProducts.push({
              id: Number(p.id),
              name: p.name,
              vendor_id: Number(p.vendor_id),
              vendor_name: p.vendor_name,
              vendor_slug: p.vendor_slug,
            });
          }
          return { key: sub.key, label: sub.label, products: cellProducts };
        }),
      }));

      return { account_id: Number(accountId), buckets };
    });
  }
}
