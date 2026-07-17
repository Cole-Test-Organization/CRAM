import type { PoolClient } from 'pg';
import { withUser } from '../../db/connection.js';
import { badRequest, conflict, notFound } from '../../lib/http-error.js';

const NODE_COLS = [
  'c.id',
  'c.full_name',
  'c.company',
  'c.title',
  'c.email',
  'c.phone',
  'c.linkedin',
  'c.kind',
  'c.created_at',
  'c.updated_at',
];

export type OrgChartEdgeInput = {
  contact_id: number;
  reports_to_contact_id: number;
};

export class OrgChartService {
  async getByAccountId(userId: number, accountId: number) {
    return withUser(userId, async (client) => {
      await this._assertAccount(client, accountId);
      return this._fetchChart(client, accountId);
    });
  }

  async setManager(userId: number, accountId: number, contactId: number, reportsToContactId: number | null) {
    return withUser(userId, async (client) => {
      await this._assertAccount(client, accountId);
      await this._assertEligibleContact(client, accountId, contactId, 'contact_id');

      if (reportsToContactId != null) {
        await this._assertEdge(client, accountId, contactId, reportsToContactId);
        // Selecting an unassigned manager is an intentional chart placement:
        // materialize that manager as a top-level node in the same transaction.
        await client.query(
          `INSERT INTO account_contact_reporting (account_id, contact_id, reports_to_contact_id)
           VALUES ($1, $2, NULL)
           ON CONFLICT (account_id, contact_id) DO NOTHING`,
          [accountId, reportsToContactId],
        );
      }

      await client.query(
        `INSERT INTO account_contact_reporting (account_id, contact_id, reports_to_contact_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (account_id, contact_id)
         DO UPDATE SET reports_to_contact_id = EXCLUDED.reports_to_contact_id`,
        [accountId, contactId, reportsToContactId],
      );
      return this._fetchChart(client, accountId);
    });
  }

  async remove(userId: number, accountId: number, contactId: number) {
    return withUser(userId, async (client) => {
      await this._assertAccount(client, accountId);
      await this._assertEligibleContact(client, accountId, contactId, 'contact_id');

      const directReport = (await client.query(
        `SELECT 1
         FROM account_contact_reporting
         WHERE account_id = $1 AND reports_to_contact_id = $2
         LIMIT 1`,
        [accountId, contactId],
      )).rows[0];
      if (directReport) {
        throw conflict('Reassign this contact\'s direct reports before removing them from the org chart.');
      }

      await client.query(
        'DELETE FROM account_contact_reporting WHERE account_id = $1 AND contact_id = $2',
        [accountId, contactId],
      );
      return this._fetchChart(client, accountId);
    });
  }

  async replace(userId: number, accountId: number, edges: OrgChartEdgeInput[], rootContactIds: number[] = []) {
    return withUser(userId, async (client) => {
      await this._assertAccount(client, accountId);
      if (!Array.isArray(edges)) {
        throw badRequest('edges must be an array of { contact_id, reports_to_contact_id } rows.');
      }
      if (!Array.isArray(rootContactIds)) {
        throw badRequest('root_contact_ids must be an array of contact ids.');
      }

      const eligibleIds = await this._eligibleContactIds(client, accountId);
      const byContact = new Map<number, number>();
      for (const edge of edges) {
        const contactId = Number(edge?.contact_id);
        const managerId = Number(edge?.reports_to_contact_id);
        if (!Number.isInteger(contactId) || !Number.isInteger(managerId)) {
          throw badRequest('Each org chart edge requires numeric contact_id and reports_to_contact_id.');
        }
        if (contactId === managerId) {
          throw badRequest(`contact_id=${contactId} cannot report to itself.`);
        }
        if (!eligibleIds.has(contactId)) {
          throw badRequest(`contact_id=${contactId} is not an external contact linked to account_id=${accountId}.`);
        }
        if (!eligibleIds.has(managerId)) {
          throw badRequest(`reports_to_contact_id=${managerId} is not an external contact linked to account_id=${accountId}.`);
        }
        if (byContact.has(contactId)) {
          throw badRequest(`Duplicate org chart edge for contact_id=${contactId}. A contact can have only one manager per account.`);
        }
        byContact.set(contactId, managerId);
      }

      const explicitRoots = new Set<number>();
      for (const rawContactId of rootContactIds) {
        const contactId = Number(rawContactId);
        if (!Number.isInteger(contactId)) {
          throw badRequest('root_contact_ids must contain only numeric contact ids.');
        }
        if (!eligibleIds.has(contactId)) {
          throw badRequest(`root contact_id=${contactId} is not an external contact linked to account_id=${accountId}.`);
        }
        if (explicitRoots.has(contactId)) {
          throw badRequest(`Duplicate root contact_id=${contactId}.`);
        }
        if (byContact.has(contactId)) {
          throw badRequest(`contact_id=${contactId} cannot be both a root and a report.`);
        }
        explicitRoots.add(contactId);
      }

      this._assertNoCycles(byContact);

      await client.query('DELETE FROM account_contact_reporting WHERE account_id = $1', [accountId]);
      const memberIds = new Set(explicitRoots);
      for (const [contactId, managerId] of byContact.entries()) {
        memberIds.add(contactId);
        memberIds.add(managerId);
      }

      if (memberIds.size) {
        const values: any[] = [];
        const placeholders: string[] = [];
        for (const contactId of memberIds) {
          values.push(accountId, contactId, byContact.get(contactId) ?? null);
          const start = values.length - 2;
          placeholders.push(`($${start}, $${start + 1}, $${start + 2})`);
        }
        await client.query(
          `INSERT INTO account_contact_reporting (account_id, contact_id, reports_to_contact_id)
           VALUES ${placeholders.join(', ')}`,
          values,
        );
      }

      return this._fetchChart(client, accountId);
    });
  }

  async _assertAccount(client: PoolClient, accountId: number) {
    const row = (await client.query('SELECT id FROM accounts WHERE id = $1', [accountId])).rows[0];
    if (!row) throw notFound(`Account not found: ${accountId}`);
  }

  async _eligibleContactIds(client: PoolClient, accountId: number) {
    const result = await client.query(
      `SELECT c.id
       FROM contacts c
       JOIN account_contacts ac ON ac.contact_id = c.id
       WHERE ac.account_id = $1 AND c.kind <> 'internal'`,
      [accountId],
    );
    return new Set(result.rows.map((row) => Number(row.id)));
  }

  async _assertEligibleContact(client: PoolClient, accountId: number, contactId: number, fieldName: string) {
    const row = (await client.query(
      `SELECT c.id
       FROM contacts c
       JOIN account_contacts ac ON ac.contact_id = c.id
       WHERE ac.account_id = $1 AND c.id = $2 AND c.kind <> 'internal'`,
      [accountId, contactId],
    )).rows[0];
    if (!row) {
      throw badRequest(`${fieldName}=${contactId} is not an external contact linked to account_id=${accountId}.`);
    }
  }

  async _assertEdge(client: PoolClient, accountId: number, contactId: number, reportsToContactId: number) {
    if (contactId === reportsToContactId) {
      throw badRequest('A contact cannot report to themselves.');
    }
    await this._assertEligibleContact(client, accountId, reportsToContactId, 'reports_to_contact_id');

    const cycle = (await client.query(
      `WITH RECURSIVE managers(contact_id) AS (
         SELECT $2::bigint
         UNION
         SELECT acr.reports_to_contact_id
         FROM account_contact_reporting acr
         JOIN managers m ON acr.account_id = $1 AND acr.contact_id = m.contact_id
       )
       SELECT 1 FROM managers WHERE contact_id = $3 LIMIT 1`,
      [accountId, reportsToContactId, contactId],
    )).rows[0];
    if (cycle) {
      throw badRequest('That reporting relationship would create a cycle in the org chart.');
    }
  }

  _assertNoCycles(edges: Map<number, number>) {
    const visiting = new Set<number>();
    const visited = new Set<number>();

    const visit = (contactId: number, path: number[]) => {
      if (visited.has(contactId)) return;
      if (visiting.has(contactId)) {
        throw badRequest(`Org chart edges contain a cycle: ${[...path, contactId].join(' -> ')}.`);
      }

      visiting.add(contactId);
      const managerId = edges.get(contactId);
      if (managerId != null && edges.has(managerId)) {
        visit(managerId, [...path, contactId]);
      }
      visiting.delete(contactId);
      visited.add(contactId);
    };

    for (const contactId of edges.keys()) {
      visit(contactId, []);
    }
  }

  async _fetchChart(client: PoolClient, accountId: number) {
    const rows = (await client.query(
      `SELECT ${NODE_COLS.join(', ')},
              acr.contact_id IS NOT NULL AS in_org_chart,
              acr.reports_to_contact_id
       FROM contacts c
       JOIN account_contacts ac ON ac.contact_id = c.id
       LEFT JOIN account_contact_reporting acr
         ON acr.account_id = ac.account_id
        AND acr.contact_id = c.id
       WHERE ac.account_id = $1 AND c.kind <> 'internal'
       ORDER BY c.full_name NULLS LAST, c.email NULLS LAST, c.id`,
      [accountId],
    )).rows;

    const contacts = rows.map(({ in_org_chart: _inOrgChart, reports_to_contact_id: _managerId, ...contact }) => contact);
    const nodes = rows
      .filter((row) => row.in_org_chart)
      .map(({ in_org_chart: _inOrgChart, ...node }) => node);
    const nodeIds = new Set(nodes.map((node) => Number(node.id)));
    const edges = nodes
      .filter((node) => node.reports_to_contact_id != null && nodeIds.has(Number(node.reports_to_contact_id)))
      .map((node) => ({
        contact_id: Number(node.id),
        reports_to_contact_id: Number(node.reports_to_contact_id),
      }));

    return {
      account_id: accountId,
      contacts,
      nodes,
      edges,
      root_contact_ids: nodes
        .filter((node) => node.reports_to_contact_id == null)
        .map((node) => Number(node.id)),
    };
  }
}
