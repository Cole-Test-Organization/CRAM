#!/usr/bin/env node

// Runs the API integration suite (api/test) against a READY, ISOLATED Postgres:
//
//     migrate → boot API (background) → wait /health → seed → node --test → stop API
//
// The CALLER provides Postgres via DATABASE_URL and owns its lifecycle (create +
// destroy). This script never provisions or wipes a database itself, so the exact
// same orchestration runs in both places:
//
//   • Local : `npm run test:api` → dev/scripts/test/test-api.sh brings up the `db-test`
//             compose service (throwaway tmpfs Postgres on :55433), then runs this.
//   • CI    : .github/workflows/ci.yml starts a `postgres:16` service on :5432,
//             then runs this.
//
// DATABASE_URL must point at a FRESH database — seed-dev-data.js deliberately
// refuses to seed on top of existing accounts.
//
// Boots the real Fastify app on the host (no Docker, no Ollama): auth resolves to
// the migration-seeded default user, and neither boot nor the tested endpoints
// contact the LLM, so a migrated empty Postgres is the only dependency.
//
// Env:
//   DATABASE_URL   (required)   test Postgres DSN
//   TEST_API_PORT  (opt, 3201)  port the test API listens on (off dev's 3200)
//
// Uses only Node built-ins — no third-party deps, so dev/ needs no `npm install`.

import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const apiDir = path.join(repoRoot, 'api');
const seedScript = path.join(repoRoot, 'dev', 'scripts', 'seed-dev-data.js');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('✗ DATABASE_URL is required — point it at a fresh, isolated test Postgres.');
  process.exit(2);
}

const PORT = process.env.TEST_API_PORT || '3201';
const HOST = '127.0.0.1';
const API_BASE = `http://${HOST}:${PORT}/api`;

// Boot/migrate env, isolated from the dev stack. TODOIST_ENABLED=false keeps the
// boot tokenless and Todoist out of scope (no test covers it). LOG_LEVEL=warn
// quiets the per-request log noise so test output is readable.
const serverEnv = {
  ...process.env,
  DATABASE_URL,
  PORT,
  HOST,
  NODE_ENV: 'test',
  LOG_LEVEL: process.env.LOG_LEVEL || 'warn',
  TODOIST_ENABLED: 'false',
};

let apiProc = null;
let stopping = false;

// Spawn a command, inheriting stdio; resolve on exit 0, reject otherwise.
function run(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', env });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`\`${cmd} ${args.join(' ')}\` exited with ${signal ? `signal ${signal}` : `code ${code}`}`));
    });
  });
}

async function waitForHealth(url, attempts = 60, delayMs = 1000) {
  for (let i = 0; i < attempts; i++) {
    if (stopping) throw new Error('aborted while waiting for API health');
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // API not up yet — keep polling.
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`API never became healthy at ${url} after ${attempts}s`);
}

function stopApi() {
  stopping = true;
  if (apiProc && apiProc.exitCode === null && !apiProc.killed) {
    apiProc.kill('SIGTERM');
  }
}

async function main() {
  // 1 — migrate the fresh DB: schema + default user (auth resolves to it) +
  //     the seeded vendor/product/theme catalogs the fixtures reference.
  console.log('▸ migrating test database…');
  await run('npm', ['--prefix', apiDir, 'run', 'db:migrate'], serverEnv);

  // 2 — boot the real Fastify API in the background, pointed at the test DB.
  console.log(`▸ booting API on http://${HOST}:${PORT} …`);
  // Boot via api's local tsx binary so the suite runs against the real .ts
  // sources (no precompile step). Absolute bin + entry paths keep the original
  // cwd. The host already installs api deps (see test-api.sh), so tsx is present.
  apiProc = spawn(path.join(apiDir, 'node_modules', '.bin', 'tsx'), [path.join(apiDir, 'src', 'index.ts')], { stdio: 'inherit', env: serverEnv });
  apiProc.on('exit', (code, signal) => {
    // If it dies before we've intentionally stopped it, fail loudly.
    if (!stopping) {
      console.error(`✗ API process exited early (${signal ? `signal ${signal}` : `code ${code}`}).`);
      process.exit(1);
    }
  });

  // 3 — wait until it's actually serving.
  await waitForHealth(`${API_BASE}/health`);
  console.log('▸ API healthy.');

  // 4 — seed deterministic fixtures through the live API (refuses if non-empty).
  console.log('▸ seeding fixtures…');
  await run('node', [seedScript], { ...process.env, API_BASE });

  // 5 — run the integration suite against the live, seeded API.
  console.log('▸ running api/test…\n');
  await run('npm', ['--prefix', apiDir, 'test'], { ...process.env, API_URL: API_BASE });
}

main()
  .then(() => {
    stopApi();
    console.log('\n✅ API integration suite passed.');
    process.exit(0);
  })
  .catch((err) => {
    console.error(`\n✗ ${err.message}`);
    stopApi();
    process.exit(1);
  });
