import { getPool, withUser } from '../db/connection.js';
import { jsonb } from './_json.js';
import { badRequest } from '../lib/http-error.js';

const EVENT_COLS = `
  id, source, source_id, title, summary, start_date, end_date, mode,
  location_raw, city, state, country, venue, url, tags,
  scraped_at, first_seen_at, created_at, updated_at
`;

const VALID_MODES = new Set(['in_person', 'virtual', 'hybrid', 'on_demand']);

function normalizeMode(mode) {
  if (mode == null) return null;
  if (!VALID_MODES.has(mode)) {
    throw badRequest(`Invalid mode: ${mode}. Must be one of: ${[...VALID_MODES].join(', ')}`);
  }
  return mode;
}

export class EventsService {
  // Events are global data — no user scoping. Pool, not withUser.
  async list({ city, country, mode, source, after, before, has_location, search, tags, sort = 'start_date', order = 'asc', limit = 200, offset = 0 } = {}) {
    const validSorts = new Set(['start_date', 'end_date', 'title', 'created_at', 'updated_at']);
    const sortCol = validSorts.has(sort) ? sort : 'start_date';
    const sortOrder = order === 'desc' ? 'DESC' : 'ASC';

    const params = [];
    const conditions = [];

    if (city) {
      params.push(city);
      conditions.push(`LOWER(city) = LOWER($${params.length})`);
    }
    if (country) {
      params.push(country);
      conditions.push(`LOWER(country) = LOWER($${params.length})`);
    }
    if (mode) {
      params.push(normalizeMode(mode));
      conditions.push(`mode = $${params.length}`);
    }
    if (source) {
      params.push(source);
      conditions.push(`source = $${params.length}`);
    }
    if (after) {
      params.push(after);
      conditions.push(`(start_date IS NULL OR start_date >= $${params.length})`);
    }
    if (before) {
      params.push(before);
      conditions.push(`(start_date IS NULL OR start_date <= $${params.length})`);
    }
    if (has_location) {
      conditions.push(`city IS NOT NULL`);
    }
    if (search) {
      params.push(`%${search}%`);
      const p = params.length;
      conditions.push(`(title ILIKE $${p} OR summary ILIKE $${p} OR location_raw ILIKE $${p})`);
    }
    if (tags) {
      // tags is a JSONB array of strings. Match if ANY supplied tag is present.
      // Accept either a comma-string or an array; normalize to a JSON array.
      const list = Array.isArray(tags)
        ? tags
        : String(tags).split(',').map((t) => t.trim()).filter(Boolean);
      if (list.length) {
        params.push(JSON.stringify(list));
        conditions.push(`tags ?| ARRAY(SELECT jsonb_array_elements_text($${params.length}::jsonb))`);
      }
    }

    const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    params.push(limit, offset);
    const sql = `
      SELECT ${EVENT_COLS}
      FROM events
      ${whereClause}
      ORDER BY ${sortCol} ${sortOrder} NULLS LAST, id ${sortOrder}
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;

    const pool = getPool();
    const rows = (await pool.query(sql, params)).rows;
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS count FROM events ${whereClause}`,
      params.slice(0, params.length - 2)
    );
    return { events: rows, total: countRes.rows[0].count };
  }

  // Facet counts for the frontend filter sidebar — distinct values + counts
  // for the columns the list endpoint can filter on. Computed in a single
  // round trip; cheap at 100s of events, would need materialization at 100k+.
  async getFacets() {
    const pool = getPool();
    const [cities, countries, modes, sources, tags] = await Promise.all([
      pool.query(`
        SELECT city AS value, COUNT(*)::int AS count
        FROM events WHERE city IS NOT NULL
        GROUP BY city ORDER BY count DESC, value ASC
      `),
      pool.query(`
        SELECT country AS value, COUNT(*)::int AS count
        FROM events WHERE country IS NOT NULL
        GROUP BY country ORDER BY count DESC, value ASC
      `),
      pool.query(`
        SELECT mode AS value, COUNT(*)::int AS count
        FROM events WHERE mode IS NOT NULL
        GROUP BY mode ORDER BY count DESC, value ASC
      `),
      pool.query(`
        SELECT source AS value, COUNT(*)::int AS count
        FROM events
        GROUP BY source ORDER BY count DESC, value ASC
      `),
      pool.query(`
        SELECT tag AS value, COUNT(*)::int AS count
        FROM events, jsonb_array_elements_text(tags) AS tag
        GROUP BY tag ORDER BY count DESC, value ASC
      `),
    ]);
    return {
      cities: cities.rows,
      countries: countries.rows,
      modes: modes.rows,
      sources: sources.rows,
      tags: tags.rows,
    };
  }

  async getById(id) {
    const pool = getPool();
    const row = (await pool.query(
      `SELECT ${EVENT_COLS} FROM events WHERE id = $1`,
      [id]
    )).rows[0];
    return row || null;
  }

  // Idempotent upsert keyed on (source, source_id). The scraper calls this for
  // every event card it finds; re-scrapes update fields rather than duplicating.
  // first_seen_at is preserved across updates; scraped_at is bumped every call.
  async upsert(data) {
    if (!data.source || !data.source_id || !data.title) {
      throw badRequest('upsert requires source, source_id, and title');
    }
    const mode = normalizeMode(data.mode);
    const pool = getPool();
    const row = (await pool.query(
      `INSERT INTO events (
         source, source_id, title, summary, start_date, end_date, mode,
         location_raw, city, state, country, venue, url, tags, scraped_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, coalesce($14, '[]'::jsonb), NOW()
       )
       ON CONFLICT (source, source_id) DO UPDATE SET
         title        = EXCLUDED.title,
         summary      = EXCLUDED.summary,
         start_date   = EXCLUDED.start_date,
         end_date     = EXCLUDED.end_date,
         mode         = EXCLUDED.mode,
         location_raw = EXCLUDED.location_raw,
         city         = EXCLUDED.city,
         state        = EXCLUDED.state,
         country      = EXCLUDED.country,
         venue        = EXCLUDED.venue,
         url          = EXCLUDED.url,
         tags         = EXCLUDED.tags,
         scraped_at   = NOW()
       RETURNING ${EVENT_COLS}`,
      [
        data.source,
        data.source_id,
        data.title,
        data.summary || null,
        data.start_date || null,
        data.end_date || null,
        mode,
        data.location_raw || null,
        data.city || null,
        data.state || null,
        data.country || null,
        data.venue || null,
        data.url || null,
        jsonb(data.tags),
      ]
    )).rows[0];
    return row;
  }

  async upsertMany(items) {
    const results = [];
    for (const item of items) {
      results.push(await this.upsert(item));
    }
    return results;
  }

  async delete(id) {
    const pool = getPool();
    const row = (await pool.query(
      'DELETE FROM events WHERE id = $1 RETURNING id, title',
      [id]
    )).rows[0];
    return row || null;
  }

  // For the "events near my contacts" view. Joins the global events table to
  // the caller's contacts on city + country (case-insensitive). Requires a
  // user context because contacts are per-user; events themselves are not.
  async upcomingWithMatchedContacts(userId, { after, before, mode = 'in_person', limit = 100 } = {}) {
    return withUser(userId, async (client) => {
      const params = [];
      const conditions = ['e.city IS NOT NULL'];

      if (mode) {
        params.push(normalizeMode(mode));
        conditions.push(`e.mode = $${params.length}`);
      }
      if (after) {
        params.push(after);
        conditions.push(`(e.start_date IS NULL OR e.start_date >= $${params.length})`);
      } else {
        // Default: only future events
        conditions.push(`(e.start_date IS NULL OR e.start_date >= CURRENT_DATE)`);
      }
      if (before) {
        params.push(before);
        conditions.push(`(e.start_date IS NULL OR e.start_date <= $${params.length})`);
      }

      params.push(limit);
      const whereClause = 'WHERE ' + conditions.join(' AND ');

      // Pull events first, then aggregate matched contacts per event. RLS scopes
      // the contacts subquery to this user automatically; the events scan is
      // unrestricted (events have no user_id).
      const events = (await client.query(
        `SELECT ${EVENT_COLS.split(',').map(c => `e.${c.trim()}`).join(', ')},
                COALESCE(
                  (SELECT json_agg(json_build_object(
                            'id', c.id,
                            'full_name', c.full_name,
                            'company', c.company,
                            'title', c.title,
                            'email', c.email,
                            'city', c.city,
                            'state', c.state,
                            'country', c.country,
                            'kind', c.kind
                          ) ORDER BY c.full_name)
                   FROM contacts c
                   WHERE LOWER(c.city) = LOWER(e.city)
                     AND (c.country IS NULL OR e.country IS NULL OR LOWER(c.country) = LOWER(e.country))
                  ),
                  '[]'::json
                ) AS matched_contacts
         FROM events e
         ${whereClause}
         ORDER BY e.start_date ASC NULLS LAST, e.id ASC
         LIMIT $${params.length}`,
        params
      )).rows;

      // Drop events with zero matches — caller wants the join, not the firehose.
      return events.filter((e) => Array.isArray(e.matched_contacts) && e.matched_contacts.length > 0);
    });
  }
}
