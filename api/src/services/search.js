import { withUser } from '../db/connection.js';

export class SearchService {
  /**
   * Global search across all tables using Postgres tsvector/tsquery.
   * RLS on each table scopes results to the current user.
   */
  async search(userId, query, { type = 'all', limit = 20 } = {}) {
    const tsQuery = buildTsQuery(query);
    if (!tsQuery) return { results: {}, query, total: 0 };

    return withUser(userId, async (client) => {
      const results = {};

      if (type === 'all' || type === 'accounts') {
        results.accounts = (await client.query(`
          SELECT a.id, a.slug, a.name, a.status, a.last_contact,
            ts_headline('english', coalesce(a.relationship_summary, ''),
              to_tsquery('english', $1),
              'StartSel=<mark>, StopSel=</mark>, MaxWords=20, MinWords=5, ShortWord=3, HighlightAll=FALSE'
            ) AS snippet,
            ts_rank(a.search_vector, to_tsquery('english', $1)) AS rank
          FROM accounts a
          WHERE a.search_vector @@ to_tsquery('english', $1)
          ORDER BY rank DESC
          LIMIT $2
        `, [tsQuery, limit])).rows;
      }

      if (type === 'all' || type === 'contacts') {
        results.contacts = (await client.query(`
          SELECT DISTINCT c.id, c.full_name, c.company, c.title, c.email,
            (SELECT string_agg(a2.slug, ',')
             FROM account_contacts ac2 JOIN accounts a2 ON a2.id = ac2.account_id
             WHERE ac2.contact_id = c.id) AS account_slug,
            (SELECT string_agg(a2.name, ', ')
             FROM account_contacts ac2 JOIN accounts a2 ON a2.id = ac2.account_id
             WHERE ac2.contact_id = c.id) AS account_name,
            ts_headline('english', coalesce(c.notes, ''),
              to_tsquery('english', $1),
              'StartSel=<mark>, StopSel=</mark>, MaxWords=20, MinWords=5, ShortWord=3, HighlightAll=FALSE'
            ) AS snippet,
            ts_rank(c.search_vector, to_tsquery('english', $1)) AS rank
          FROM contacts c
          WHERE c.search_vector @@ to_tsquery('english', $1)
          ORDER BY rank DESC
          LIMIT $2
        `, [tsQuery, limit])).rows;
      }

      if (type === 'all' || type === 'meetings') {
        results.meetings = (await client.query(`
          SELECT m.id, m.date, m.title, m.filename, m.account_id, m.internal,
            a.slug AS account_slug, a.name AS account_name,
            ts_headline('english', coalesce(m.body, ''),
              to_tsquery('english', $1),
              'StartSel=<mark>, StopSel=</mark>, MaxWords=25, MinWords=5, ShortWord=3, HighlightAll=FALSE'
            ) AS snippet,
            ts_rank(m.search_vector, to_tsquery('english', $1)) AS rank
          FROM meetings m
          LEFT JOIN accounts a ON a.id = m.account_id
          WHERE m.search_vector @@ to_tsquery('english', $1)
          ORDER BY rank DESC
          LIMIT $2
        `, [tsQuery, limit])).rows;
      }

      const total = Object.values(results).reduce((sum, arr) => sum + (arr?.length || 0), 0);
      return { results, query, total };
    });
  }

  /**
   * Fuzzy search for account names only (backward-compatible).
   */
  async searchAccounts(userId, query, { limit = 5 } = {}) {
    const tsQuery = buildTsQuery(query);

    return withUser(userId, async (client) => {
      if (!tsQuery) {
        return (await client.query(
          'SELECT id, slug, name, status, last_contact FROM accounts ORDER BY name LIMIT $1',
          [limit]
        )).rows;
      }
      return (await client.query(`
        SELECT id, slug, name, status, last_contact,
          ts_rank(search_vector, to_tsquery('english', $1)) AS rank
        FROM accounts
        WHERE search_vector @@ to_tsquery('english', $1)
        ORDER BY rank DESC
        LIMIT $2
      `, [tsQuery, limit])).rows;
    });
  }
}

/**
 * Build a Postgres tsquery string from user input with prefix matching.
 * Splits on any non-alphanumeric so punctuation-bearing inputs like
 * "acme.com" or "jane@acme.com" tokenize the same way `to_tsvector` does.
 */
function buildTsQuery(input) {
  if (!input || !input.trim()) return null;
  const tokens = input
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
  if (!tokens.length) return null;
  return tokens.map(t => `${t}:*`).join(' & ');
}
