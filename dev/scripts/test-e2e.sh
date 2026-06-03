#!/usr/bin/env bash

# Local runner for the Playwright E2E suite (e2e/) against an ISOLATED throwaway DB.
#
#     npm run test:e2e        # from the repo root
#
# Brings up the `db-test` compose service (a tmpfs Postgres on :55433 — separate
# container, port, and storage from your dev `db`), then runs the
# build→migrate→boot→seed→playwright orchestration against it, then removes it.
# Your dev database is never touched.
#
# CI does the identical orchestration (dev/scripts/run-e2e-tests.js) against a
# GitHub Actions `postgres:16` service instead of this compose container.
#
# Requires Docker + Node. The host builds the GUI and boots the API directly, so
# it installs api/, outreach/, gui/, and e2e/ deps if missing, plus the
# Playwright Chromium browser.

set -euo pipefail

cd "$(dirname "$0")/../.."   # repo root

TEST_PG_PORT="${TEST_POSTGRES_PORT:-55433}"
export DATABASE_URL="postgres://${POSTGRES_USER:-crm}:${POSTGRES_PASSWORD:-devpassword}@127.0.0.1:${TEST_PG_PORT}/${POSTGRES_DB:-crm}"
export TEST_API_PORT="${TEST_API_PORT:-3201}"

# Remove ONLY the db-test container on exit (never the dev stack). Preserve the
# real exit code so a test failure still gates `npm run test:e2e` / CI.
cleanup() {
  local code=$?
  echo "▸ removing isolated test database…"
  docker compose --profile test rm -sfv db-test >/dev/null 2>&1 || true
  exit "$code"
}
trap cleanup EXIT

# Deps the host needs to build + boot + drive the stack:
#   • api/ + outreach/ — migrate + Fastify (the API statically imports outreach).
#   • gui/             — `vite build` into api/public.
#   • e2e/             — the Playwright runner.
# Chromium download is skipped for outreach's puppeteer (tests never use it).
[ -d api/node_modules ] || npm --prefix api ci
[ -d outreach/node_modules/pino ] || PUPPETEER_SKIP_DOWNLOAD=true npm --prefix outreach ci
[ -d gui/node_modules ] || npm --prefix gui ci
[ -d e2e/node_modules ] || npm --prefix e2e ci
# Playwright's Chromium binary (cached globally under ~/.cache/ms-playwright on
# Linux / ~/Library/Caches/ms-playwright on macOS). Idempotent + fast once cached.
./e2e/node_modules/.bin/playwright install chromium

echo "▸ starting isolated test Postgres (db-test) on :${TEST_PG_PORT}…"
# --force-recreate guarantees a brand-new tmpfs (empty DB) every run, so the
# seed never trips its "refuse to seed on top of existing data" guard.
docker compose --profile test up -d --wait --force-recreate db-test

node dev/scripts/run-e2e-tests.js
