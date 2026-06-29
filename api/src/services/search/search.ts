import { withUser } from '../../db/connection.js';

const HIGHLIGHT_START = '__CRAM_SEARCH_MARK_START__';
const HIGHLIGHT_END = '__CRAM_SEARCH_MARK_END__';
const HEADLINE_OPTIONS = `StartSel=${HIGHLIGHT_START}, StopSel=${HIGHLIGHT_END}, MaxWords=20, MinWords=5, ShortWord=3, HighlightAll=FALSE`;
const MEETING_HEADLINE_OPTIONS = `StartSel=${HIGHLIGHT_START}, StopSel=${HIGHLIGHT_END}, MaxWords=25, MinWords=5, ShortWord=3, HighlightAll=FALSE`;

export class SearchService {
  /**
   * Global search across all tables using Postgres tsvector/tsquery.
   * RLS on each table scopes results to the current user.
   */
  async search(userId: number, query: string, { type = 'all', limit = 20 }: { type?: string; limit?: number } = {}) {
    const tsQuery = buildTsQuery(query);
    if (!tsQuery) return { results: {}, query, total: 0 };

    return withUser(userId, async (client) => {
      const results: Record<string, unknown[]> = {};

      if (type === 'all' || type === 'accounts') {
        results.accounts = escapeResultSnippets((await client.query(`
          SELECT a.id, a.slug, a.name, a.status, a.last_contact,
            ts_headline('english', coalesce(a.relationship_summary, ''),
              to_tsquery('english', $1),
              $3
            ) AS snippet,
            ts_rank(a.search_vector, to_tsquery('english', $1)) AS rank
          FROM accounts a
          WHERE a.search_vector @@ to_tsquery('english', $1)
          ORDER BY rank DESC
          LIMIT $2
        `, [tsQuery, limit, HEADLINE_OPTIONS])).rows);
      }

      if (type === 'all' || type === 'contacts') {
        results.contacts = escapeResultSnippets((await client.query(`
          SELECT DISTINCT c.id, c.full_name, c.company, c.title, c.email,
            (SELECT string_agg(a2.slug, ',')
             FROM account_contacts ac2 JOIN accounts a2 ON a2.id = ac2.account_id
             WHERE ac2.contact_id = c.id) AS account_slug,
            (SELECT string_agg(a2.name, ', ')
             FROM account_contacts ac2 JOIN accounts a2 ON a2.id = ac2.account_id
             WHERE ac2.contact_id = c.id) AS account_name,
            ts_headline('english', coalesce(c.notes, ''),
              to_tsquery('english', $1),
              $3
            ) AS snippet,
            ts_rank(c.search_vector, to_tsquery('english', $1)) AS rank
          FROM contacts c
          WHERE c.search_vector @@ to_tsquery('english', $1)
          ORDER BY rank DESC
          LIMIT $2
        `, [tsQuery, limit, HEADLINE_OPTIONS])).rows);
      }

      if (type === 'all' || type === 'meetings') {
        results.meetings = escapeResultSnippets((await client.query(`
          SELECT m.id, m.date, m.title, m.filename, m.account_id, m.internal,
            a.slug AS account_slug, a.name AS account_name,
            ts_headline('english', coalesce(m.body, ''),
              to_tsquery('english', $1),
              $3
            ) AS snippet,
            ts_rank(m.search_vector, to_tsquery('english', $1)) AS rank
          FROM meetings m
          LEFT JOIN accounts a ON a.id = m.account_id
          WHERE m.search_vector @@ to_tsquery('english', $1) AND m.deleted_at IS NULL
          ORDER BY rank DESC
          LIMIT $2
        `, [tsQuery, limit, MEETING_HEADLINE_OPTIONS])).rows);
      }

      if (type === 'all' || type === 'opportunities') {
        results.opportunities = escapeResultSnippets((await client.query(`
          SELECT o.id, o.name, o.stage, o.account_id,
            a.slug AS account_slug, a.name AS account_name,
            ts_headline('english', coalesce(o.notes, ''),
              to_tsquery('english', $1),
              $3
            ) AS snippet,
            ts_rank(o.search_vector, to_tsquery('english', $1)) AS rank
          FROM opportunities o
          JOIN accounts a ON a.id = o.account_id
          WHERE o.search_vector @@ to_tsquery('english', $1)
          ORDER BY rank DESC
          LIMIT $2
        `, [tsQuery, limit, HEADLINE_OPTIONS])).rows);
      }

      const total = Object.values(results).reduce((sum, arr) => sum + (arr?.length || 0), 0);
      return { results, query, total };
    });
  }

  /**
   * Fuzzy search for account names only (backward-compatible).
   */
  async searchAccounts(userId: number, query: string, { limit = 5 }: { limit?: number } = {}) {
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
function buildTsQuery(input: string): string | null {
  if (!input || !input.trim()) return null;
  const tokens = input
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
  if (!tokens.length) return null;
  return tokens.map(t => `${t}:*`).join(' & ');
}

function escapeResultSnippets<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((row) => {
    if (typeof row.snippet !== 'string') return row;
    return { ...row, snippet: renderSnippetHtml(row.snippet) };
  });
}

function renderSnippetHtml(snippet: string): string {
  return escapeHtml(snippet)
    .replaceAll(HIGHLIGHT_START, '<mark>')
    .replaceAll(HIGHLIGHT_END, '</mark>');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
