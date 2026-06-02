#!/usr/bin/env node

// Clears the LOCAL dev CRM so you can re-run imports from a clean slate.
// Host-runnable like dump-schema.js (uses dev/'s own `pg`).
//
//   node dev/scripts/clear-db.js              # DRY RUN — prints what WOULD be wiped, changes nothing
//   node dev/scripts/clear-db.js --yes        # wipe transactional CRM data (accounts/contacts/meetings/opps/notes/events)
//   node dev/scripts/clear-db.js --all --yes  # also wipe settings/memories/sessions (keep only users + schema)
//   npm --prefix api run db:clear -- --yes    # same, via npm (note the `--` before flags)
//
// SAFETY
//   - Refuses any non-local host (your REAL data lives in the remote CRM, not here).
//     Override only with ALLOW_NONLOCAL=1 if you genuinely mean it.
//   - DRY RUN is the default; nothing is deleted without --yes.
//   - `users` and `pgmigrations` are ALWAYS preserved — wiping either breaks the app
//     (auth can't resolve the default user; node-pg-migrate loses its bookkeeping).
//   - TRUNCATE is run WITHOUT CASCADE: if a future schema change makes a preserved
//     table depend on a wiped one, this fails loudly instead of silently nuking it.

import pg from 'pg';

const connectionString =
  process.env.DATABASE_URL || 'postgres://crm:devpassword@localhost:5432/crm';

const flags = new Set(process.argv.slice(2));
const EXECUTE = flags.has('--yes') || flags.has('-y');
const ALL = flags.has('--all');

// Never wiped — the app won't boot without them.
const ALWAYS_KEEP = ['pgmigrations', 'users'];
// Config / operational state (not CRM data). Kept by default; --all drops these too.
const CONFIG_KEEP = [
  'user_agent_settings',    // local-LLM base URL + model — imports fail without it
  'app_settings',           // global app config / onboarding state
  'user_internal_domains',  // internal-vs-external rules that feed import classification
  'user_theme_settings',    // per-user theme pick
  'user_memories',          // the agent's own memory store
  'agent_sessions',         // chat history
  // Seeded by migrations (012 default catalog, 014 vendor catalog, 026 themes) — a plain
  // `db:migrate` won't restore these once wiped, so keep them unless you pass --all.
  'themes',
  'vendors',
  'vendor_products',
  'products',
  'product_categories',
];
const PRESERVE = new Set(ALL ? ALWAYS_KEEP : [...ALWAYS_KEEP, ...CONFIG_KEEP]);

function localHostOrDie(cs) {
  let host = null;
  try { host = new URL(cs).hostname; } catch { /* non-URL DSN — treat as unknown */ }
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '';
  if (!isLocal && process.env.ALLOW_NONLOCAL !== '1') {
    console.error(`\n✋ Refusing to clear a non-local database (host: ${host ?? 'unparseable'}).`);
    console.error('   This script is for the LOCAL dev CRM only — your real data lives elsewhere.');
    console.error('   If you truly mean it, re-run with ALLOW_NONLOCAL=1.\n');
    process.exit(1);
  }
  return host || '(local socket)';
}

const pool = new pg.Pool({ connectionString, max: 5 });

async function main() {
  const host = localHostOrDie(connectionString);
  const dbName = (await pool.query('SELECT current_database()')).rows[0].current_database;

  // Every base table in public (pgmigrations included — it's in PRESERVE).
  const { rows } = await pool.query(`
    SELECT c.relname AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  `);
  const allTables = rows.map((r) => r.name);
  const targets = allTables.filter((t) => !PRESERVE.has(t));
  const preserved = allTables.filter((t) => PRESERVE.has(t));

  // Count rows so you see exactly what's about to go.
  let totalRows = 0;
  const counts = {};
  for (const t of targets) {
    counts[t] = Number((await pool.query(`SELECT count(*)::int AS n FROM "${t}"`)).rows[0].n);
    totalRows += counts[t];
  }

  console.log('');
  console.log(`  Database : ${dbName} @ ${host}`);
  console.log(`  Mode     : ${ALL ? '--all  (wipe EVERYTHING but users + schema)' : 'default  (wipe transactional CRM data; keep catalogs + settings)'}`);
  console.log('');
  console.log(`  Will TRUNCATE ${targets.length} table(s) — ${totalRows} row(s):`);
  for (const t of targets) console.log(`    · ${t}  (${counts[t]})`);
  console.log('');
  console.log(`  Preserving ${preserved.length}: ${preserved.join(', ')}`);
  console.log('');

  if (!EXECUTE) {
    console.log('  DRY RUN — nothing changed. Add --yes to execute.\n');
    await pool.end();
    return;
  }
  if (targets.length === 0) {
    console.log('  Nothing to truncate.\n');
    await pool.end();
    return;
  }

  // All referencing tables are inside `targets`, so one statement (no CASCADE) suffices;
  // RESTART IDENTITY resets sequences so re-imported rows start from id 1.
  const list = targets.map((t) => `"${t}"`).join(', ');
  try {
    await pool.query(`TRUNCATE TABLE ${list} RESTART IDENTITY`);
  } catch (err) {
    console.error(`\n  ✗ TRUNCATE failed: ${err.message}`);
    console.error('    A preserved table likely now references a wiped one. Move it into the wipe');
    console.error('    set (or run with --all), then retry.\n');
    await pool.end();
    process.exit(1);
  }
  console.log(`  ✅ Cleared ${targets.length} table(s), ${totalRows} row(s). Sequences reset.\n`);
  await pool.end();
}

main().catch((err) => {
  console.error('Failed to clear database:', err.message);
  pool.end().catch(() => {});
  process.exit(1);
});
