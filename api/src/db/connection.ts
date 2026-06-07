import pg from 'pg';
import type { Pool as PgPool, PoolClient } from 'pg';
import { getConfig } from '../config.js';
import { logger as rootLogger } from '../lib/logger.js';

const logger = rootLogger.child({ component: 'db' });

const { Pool, types } = pg;

// BIGINT (int8) → JS number. Row counts stay well under Number.MAX_SAFE_INTEGER,
// and the GUI/agent expect numeric IDs.
types.setTypeParser(types.builtins.INT8, (val: string | null) => (val == null ? null : parseInt(val, 10)));
// BIGINT[] (_int8, OID 1016) — same coercion applied per element. account_details
// stores per-category vendor product references as bigint[]; without this parser
// the API would emit string IDs and the GUI/agent would fight type mismatches.
// @ts-expect-error pg-types' TypeId enum only enumerates scalar OIDs; the raw _int8 array OID (1016) is valid at runtime.
types.setTypeParser(1016, (val: string | null) => {
  if (val == null) return null;
  // pg array literal: "{1,2,3}" or "{}". null elements arrive as the literal NULL.
  const inner = val.slice(1, -1);
  if (!inner) return [];
  return inner.split(',').map((s) => (s === 'NULL' ? null : parseInt(s, 10)));
});

// DATE → raw "YYYY-MM-DD" string. The default parser wraps it in a JS Date, which
// serializes to a timezone-tagged ISO string and breaks existing consumers.
types.setTypeParser(types.builtins.DATE, (val: string) => val);

let pool: PgPool | null = null;

export function getPool(): PgPool {
  if (pool) return pool;
  const config = getConfig();
  pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl,
    max: 10,
    idleTimeoutMillis: 30000,
  });
  pool.on('error', (err) => {
    logger.error({ err: err.message, stack: err.stack }, 'unexpected PG pool error');
  });
  return pool;
}

export async function initDb(): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}

export async function withUser<T>(
  userId: number | string | null | undefined,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (userId == null) {
    throw new Error('withUser requires a userId');
  }
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [String(userId)]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
