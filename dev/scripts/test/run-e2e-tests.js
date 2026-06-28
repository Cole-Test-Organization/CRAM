#!/usr/bin/env node

// Runs the Playwright E2E suite (e2e/) against a READY, ISOLATED, seeded stack:
//
//     build GUI → migrate → boot API (serves GUI + /api) → wait /health →
//     seed → playwright test → stop API
//
// Same contract as its sibling run-api-tests.js: the CALLER provides Postgres
// via DATABASE_URL and owns its lifecycle (create + destroy). This script never
// provisions or wipes a database itself, so the identical orchestration runs in
// both places:
//
//   • Local : `npm run test:e2e` → dev/scripts/test/test-e2e.sh brings up the
//             `db-test` compose service (throwaway tmpfs Postgres on :55433),
//             then runs this.
//   • CI    : .github/workflows/e2e.yml starts a `postgres:16` service on :5432,
//             then runs this.
//
// DATABASE_URL must point at a FRESH database — seed-dev-data.js refuses to seed
// on top of existing accounts, which is exactly what keeps the run deterministic.
//
// What's different from the API suite: the GUI is BUILT (vite → api/public) and
// served by the real API via @fastify/static + the SPA fallback (see
// api/src/index.js). Playwright therefore drives a single, prod-like origin with
// no Vite dev server and no proxy in the loop.
//
// Env:
//   DATABASE_URL   (required)   test Postgres DSN
//   TEST_API_PORT  (opt, 3201)  port the API listens on — also the E2E origin
//
// Uses only Node built-ins; Playwright is invoked from e2e/node_modules.

import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const apiDir = path.join(repoRoot, 'api');
const guiDir = path.join(repoRoot, 'gui');
const e2eDir = path.join(repoRoot, 'e2e');
const seedScript = path.join(repoRoot, 'dev', 'scripts', 'seed-dev-data.js');
const playwrightBin = path.join(e2eDir, 'node_modules', '.bin', 'playwright');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('✗ DATABASE_URL is required — point it at a fresh, isolated test Postgres.');
  process.exit(2);
}

const PORT = process.env.TEST_API_PORT || '3201';
const HOST = '127.0.0.1';
const ORIGIN = `http://${HOST}:${PORT}`;
const API_BASE = `${ORIGIN}/api`;

// Boot/migrate env, isolated from the dev stack. TODOIST_ENABLED=false keeps the
// boot tokenless and Todoist out of scope. LOG_LEVEL=warn quiets per-request log
// noise so the Playwright output stays readable.
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
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', ...opts });
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

function hasExited(proc) {
  return !proc || proc.exitCode !== null || proc.signalCode !== null;
}

function waitForExit(proc, timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (hasExited(proc)) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      if (!hasExited(proc)) proc.kill('SIGKILL');
    }, timeoutMs);

    proc.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function stopApi() {
  stopping = true;
  if (apiProc && !hasExited(apiProc)) apiProc.kill('SIGTERM');
  await waitForExit(apiProc);
}

async function main() {
  // 0 — build the GUI into api/public so the real API serves it (single origin,
  //     prod-like). vite.config.ts points build.outDir at ../api/public.
  console.log('▸ building GUI (gui → api/public)…');
  await run('npm', ['--prefix', guiDir, 'run', 'build'], { env: process.env });

  // 1 — migrate the fresh DB: schema + default user (auth resolves to it) +
  //     the seeded vendor/product/theme catalogs the fixtures reference.
  console.log('▸ migrating test database…');
  await run('npm', ['--prefix', apiDir, 'run', 'db:migrate'], { env: serverEnv });

  // 2 — boot the real Fastify API in the background (serves GUI + /api).
  console.log(`▸ booting API + GUI on ${ORIGIN} …`);
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
  await run('node', [seedScript], { env: { ...process.env, API_BASE } });

  // 5 — run the Playwright suite against the live, seeded origin.
  console.log('▸ running e2e (playwright)…\n');
  await run(playwrightBin, ['test'], { cwd: e2eDir, env: { ...process.env, BASE_URL: ORIGIN } });
}

main()
  .then(async () => {
    await stopApi();
    console.log('\n✅ E2E suite passed.');
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(`\n✗ ${err.message}`);
    await stopApi();
    process.exit(1);
  });
