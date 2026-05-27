#!/usr/bin/env node

// Find (and optionally delete) kind='account' contacts that have no
// account_contacts rows — i.e., orphaned customer contacts left behind when
// their account was deleted before the AccountsService.delete sweep was in
// place. kind='partner' and kind='internal' contacts are deliberately
// untouched (they're not always linked to an account by design).
//
//   node dev/scripts/cleanup-orphan-contacts.js              # dry-run, list only
//   node dev/scripts/cleanup-orphan-contacts.js --delete     # actually delete
//
// User resolution (RLS context):
//   USER_EMAIL=foo@bar.com  node …    # explicit by email
//   USER_ID=42              node …    # explicit by id
//   (neither)                         # auto-detect if exactly one user exists

import pg from 'pg';

const connectionString =
  process.env.DATABASE_URL || 'postgres://crm:devpassword@localhost:5432/crm';

const args = new Set(process.argv.slice(2));
const doDelete = args.has('--delete');

const pool = new pg.Pool({ connectionString, max: 2 });

async function resolveUserId(client) {
  if (process.env.USER_ID) {
    const id = Number(process.env.USER_ID);
    if (!Number.isInteger(id)) throw new Error(`USER_ID must be an integer, got: ${process.env.USER_ID}`);
    const row = (await client.query('SELECT id, email FROM users WHERE id = $1', [id])).rows[0];
    if (!row) throw new Error(`No user with id=${id}`);
    return row;
  }
  if (process.env.USER_EMAIL) {
    const email = process.env.USER_EMAIL.trim().toLowerCase();
    const row = (await client.query('SELECT id, email FROM users WHERE LOWER(email) = $1', [email])).rows[0];
    if (!row) throw new Error(`No user with email=${email}`);
    return row;
  }
  const rows = (await client.query('SELECT id, email FROM users ORDER BY id')).rows;
  if (rows.length === 0) throw new Error('No users in DB');
  if (rows.length > 1) {
    throw new Error(
      `Multiple users (${rows.length}) — set USER_EMAIL or USER_ID. Available: ${rows.map((r) => `${r.id}:${r.email}`).join(', ')}`
    );
  }
  return rows[0];
}

async function main() {
  const client = await pool.connect();
  try {
    const user = await resolveUserId(client);
    console.log(`User: id=${user.id} email=${user.email}`);
    console.log(`Mode: ${doDelete ? 'DELETE' : 'dry-run (pass --delete to actually remove)'}`);
    console.log('');

    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [String(user.id)]);

    const orphans = (await client.query(`
      SELECT c.id, c.full_name, c.email, c.company, c.title, c.created_at
      FROM contacts c
      WHERE c.kind = 'account'
        AND NOT EXISTS (SELECT 1 FROM account_contacts ac WHERE ac.contact_id = c.id)
      ORDER BY c.company NULLS LAST, c.full_name
    `)).rows;

    if (orphans.length === 0) {
      console.log('No orphan account-kind contacts. Nothing to do.');
      await client.query('COMMIT');
      return;
    }

    console.log(`Found ${orphans.length} orphan contact(s):`);
    for (const o of orphans) {
      const email = o.email || '(no email)';
      const company = o.company || '(no company)';
      const title = o.title || '(no title)';
      console.log(`  - [${o.id}] ${o.full_name} <${email}> — ${title} @ ${company}`);
    }

    if (!doDelete) {
      console.log('\nDry-run only. Re-run with --delete to remove them.');
      await client.query('COMMIT');
      return;
    }

    const ids = orphans.map((o) => o.id);
    const result = await client.query(
      'DELETE FROM contacts WHERE id = ANY($1::bigint[])',
      [ids]
    );
    await client.query('COMMIT');
    console.log(`\nDeleted ${result.rowCount} contact(s).`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error('cleanup-orphan-contacts failed:', err.message);
    pool.end().catch(() => {});
    process.exit(1);
  });
