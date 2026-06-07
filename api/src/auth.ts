import type { FastifyRequest } from 'fastify';
import { getPool } from './db/connection.js';
import { getConfig } from './config.js';

let cachedDefaultUserId: number | null = null;

export async function getDefaultUserId() {
  if (cachedDefaultUserId) return cachedDefaultUserId;
  const { defaultUserEmail } = getConfig();
  const result = await getPool().query(
    'SELECT id FROM users WHERE email = $1',
    [defaultUserEmail]
  );
  if (!result.rows.length) {
    throw new Error(`Default user not found: ${defaultUserEmail}. Run migrations first.`);
  }
  cachedDefaultUserId = Number(result.rows[0].id);
  return cachedDefaultUserId;
}

// TODO: replace with real auth (magic link → session cookie) once the auth story lands.
export async function getCurrentUserId(_request: FastifyRequest) {
  return getDefaultUserId();
}
