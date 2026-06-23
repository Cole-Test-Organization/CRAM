import type { PoolClient } from 'pg';
import { withUser } from '../../db/connection.js';

// Kept in lock-step with the account_details migration.
const VENDOR_ARRAY_COLS = [
  'firewall_ids', 'edr_ids', 'siem_ids', 'idp_ids', 'mfa_ids', 'pam_ids',
  'email_security_ids', 'mdr_ids', 'msp_ids', 'sase_ids', 'sdwan_ids',
  'vpn_ids', 'dlp_ids', 'casb_ids', 'vuln_mgmt_ids', 'ticketing_ids',
  'productivity_suite_ids', 'cloud_provider_ids',
  'cspm_ids', 'appsec_ids', 'ndr_ids', 'iot_ot_ids',
];

const FIRMOGRAPHIC_LABELS = {
  industry: 'Industry',
  revenue_usd: 'Revenue (USD)',
  employee_count: 'Employees',
  user_count: 'Users',
  endpoint_count: 'Endpoints',
  server_count: 'Servers',
  site_count: 'Sites',
  dc_count: 'Data Centers',
  hq_city: 'HQ City',
  hq_state: 'HQ State',
  hq_country: 'HQ Country',
  it_team_size: 'IT Team Size',
  security_team_size: 'Security Team Size',
  soc_model: 'SOC Model',
};

export class ExportService {
  /**
   * Export a single account as markdown files.
   * Returns an array of { path, content } objects.
   */
  async exportAccount(userId: number, slug: string) {
    return withUser(userId, (client) => this._exportAccount(client, slug));
  }

  async _exportAccount(client: PoolClient, slug: string) {
    const acct = (await client.query(
      `SELECT id, slug, name, status, last_contact,
              relationship_summary, active_deals,
              created_at, updated_at
       FROM accounts WHERE slug = $1`,
      [slug]
    )).rows[0];
    if (!acct) return null;

    const details = (await client.query(
      `SELECT * FROM account_details WHERE account_id = $1`,
      [acct.id]
    )).rows[0] || null;

    if (details) {
      const allIds = new Set();
      for (const col of VENDOR_ARRAY_COLS) {
        for (const id of details[col] || []) allIds.add(Number(id));
      }
      if (allIds.size > 0) {
        const products = (await client.query(
          `SELECT vp.id, vp.name, vp.category, v.name AS vendor_name
           FROM vendor_products vp JOIN vendors v ON v.id = vp.vendor_id
           WHERE vp.id = ANY($1::bigint[])`,
          [[...allIds]]
        )).rows;
        details._productsById = new Map(products.map((p) => [Number(p.id), p]));
      } else {
        details._productsById = new Map();
      }
    }
    acct.details = details;

    const contacts = (await client.query(`
      SELECT c.id, c.full_name, c.company, c.title, c.email, c.phone, c.linkedin, c.notes, c.kind
      FROM contacts c
      JOIN account_contacts ac ON ac.contact_id = c.id
      WHERE ac.account_id = $1 AND c.kind <> 'internal' ORDER BY c.full_name
    `, [acct.id])).rows;
    const meetings = (await client.query(
      `SELECT id, account_id, date, title, filename, body, created_at, updated_at,
              (SELECT string_agg(COALESCE(c.full_name, ma.display_name), ', '
                        ORDER BY (ma.contact_id IS NULL), c.full_name, ma.display_name)
                 FROM meeting_attendees ma LEFT JOIN contacts c ON c.id = ma.contact_id
                WHERE ma.meeting_id = meetings.id) AS attendees
       FROM meetings WHERE account_id = $1 AND deleted_at IS NULL ORDER BY date DESC`,
      [acct.id]
    )).rows;

    // Partner accounts linked to this account, with their contacts
    const partners = (await client.query(`
      SELECT a.id, a.slug, a.name
      FROM account_partners ap
      JOIN accounts a ON a.id = ap.partner_account_id
      WHERE ap.customer_account_id = $1
      ORDER BY a.name
    `, [acct.id])).rows;
    for (const p of partners) {
      p.contacts = (await client.query(`
        SELECT c.full_name, c.title, c.email
        FROM contacts c
        JOIN account_contacts ac ON ac.contact_id = c.id
        WHERE ac.account_id = $1 AND c.kind = 'partner'
        ORDER BY c.full_name
      `, [p.id])).rows;
    }

    const files = [];

    files.push({
      path: `${slug}/_account.md`,
      content: renderAccountMd({ ...acct, partners }),
    });

    if (contacts.length > 0) {
      files.push({
        path: `${slug}/contacts.md`,
        content: renderContactsMd(acct.name, contacts),
      });
    }

    for (const m of meetings) {
      files.push({
        path: `${slug}/${m.filename}`,
        content: renderMeetingMd(m),
      });
    }

    return files;
  }

  async exportAll(userId: number) {
    return withUser(userId, async (client) => {
      const slugs = (await client.query('SELECT slug FROM accounts ORDER BY name')).rows.map(r => r.slug);
      const allFiles = [];

      for (const slug of slugs) {
        const files = await this._exportAccount(client, slug);
        if (files) allFiles.push(...files);
      }

      const internal = (await client.query(
        `SELECT id, date, title, filename, body, created_at, updated_at,
                (SELECT string_agg(COALESCE(c.full_name, ma.display_name), ', '
                          ORDER BY (ma.contact_id IS NULL), c.full_name, ma.display_name)
                   FROM meeting_attendees ma LEFT JOIN contacts c ON c.id = ma.contact_id
                  WHERE ma.meeting_id = meetings.id) AS attendees
         FROM meetings WHERE internal = true AND deleted_at IS NULL ORDER BY date DESC`
      )).rows;
      for (const n of internal) {
        allFiles.push({
          path: `internal/${n.filename}`,
          content: renderInternalMd(n),
        });
      }

      return allFiles;
    });
  }
}

function renderAccountMd(acct: any) {
  const lines = [`# ${acct.name}\n`];

  if (acct.status) lines.push(`**Status:** ${acct.status}`);
  if (acct.last_contact) lines.push(`**Last Contact:** ${acct.last_contact}`);
  lines.push('');

  if (acct.relationship_summary) {
    lines.push('## Relationship Summary\n');
    lines.push(acct.relationship_summary);
    lines.push('');
  }

  if (acct.details) {
    renderTechnicalProfile(lines, acct.details);
  }

  const partners = acct.partners;
  if (partners && partners.length > 0) {
    lines.push('## Channel Partners\n');
    for (const p of partners) {
      lines.push(`- **${p.name}**`);
      if (Array.isArray(p.contacts) && p.contacts.length > 0) {
        for (const c of p.contacts) {
          let line = `  - ${c.full_name}`;
          if (c.title) line += ` — ${c.title}`;
          if (c.email) line += `. ${c.email}`;
          lines.push(line);
        }
      }
    }
    lines.push('');
  }

  if (acct.active_deals) {
    lines.push('## Active Deals\n');
    lines.push(acct.active_deals);
    lines.push('');
  }

  return lines.join('\n');
}

function renderTechnicalProfile(lines: string[], details: any) {
  const facts = [];
  for (const [col, label] of Object.entries(FIRMOGRAPHIC_LABELS)) {
    if (details[col] != null && details[col] !== '') {
      facts.push(`- **${label}:** ${details[col]}`);
    }
  }
  if (details.compliance_frameworks && details.compliance_frameworks.length > 0) {
    facts.push(`- **Compliance:** ${details.compliance_frameworks.join(', ')}`);
  }
  if (details.has_ot_environment) facts.push('- **OT environment:** yes');
  if (details.has_iot_environment) facts.push('- **IoT environment:** yes');

  const vendorSections = [];
  for (const col of VENDOR_ARRAY_COLS) {
    const ids: any[] = details[col] || [];
    if (ids.length === 0) continue;
    const products = ids
      .map((id) => details._productsById.get(Number(id)))
      .filter(Boolean);
    if (products.length === 0) continue;
    const label = col.replace(/_ids$/, '').replace(/_/g, ' ');
    const formatted = products.map((p) => `${p.vendor_name} ${p.name}`.trim()).join(', ');
    vendorSections.push(`- **${label}:** ${formatted}`);
  }

  if (facts.length === 0 && vendorSections.length === 0 && !details.technical_notes) return;

  lines.push('## Technical Profile\n');
  if (facts.length > 0) {
    lines.push(...facts, '');
  }
  if (vendorSections.length > 0) {
    lines.push('### Vendor stack\n', ...vendorSections, '');
  }
  if (details.technical_notes) {
    lines.push('### Notes\n', details.technical_notes, '');
  }
}

function renderContactsMd(accountName: string, contacts: any[]) {
  const lines = [`# ${accountName} — Contacts\n`];

  for (const c of contacts) {
    lines.push(`## ${c.full_name}\n`);
    if (c.company) lines.push(`- **Company:** ${c.company}`);
    if (c.title) lines.push(`- **Title:** ${c.title}`);
    if (c.email) lines.push(`- **Email:** ${c.email}`);
    if (c.phone) lines.push(`- **Phone:** ${c.phone}`);
    if (c.linkedin) lines.push(`- **LinkedIn:** ${c.linkedin}`);
    if (c.notes) lines.push(`- **Notes:** ${c.notes}`);
    lines.push('');
  }

  return lines.join('\n');
}

function renderMeetingMd(m: any) {
  const titlePart = m.title ? ` - ${m.title.replace(/-/g, ' ')}` : '';
  const lines = [`# ${m.date}${titlePart}\n`];
  if (m.attendees) lines.push(`**Attendees:** ${m.attendees}\n`);
  lines.push('## Notes\n');
  lines.push(m.body);
  return lines.join('\n');
}

function renderInternalMd(n: any) {
  const titlePart = n.title ? ` - ${n.title.replace(/-/g, ' ')}` : '';
  const lines = [`# ${n.date}${titlePart}\n`];
  if (n.attendees) lines.push(`**Attendees:** ${n.attendees}\n`);
  lines.push('## Notes\n');
  lines.push(n.body);
  return lines.join('\n');
}
