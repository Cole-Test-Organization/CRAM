#!/usr/bin/env bash

# Local runner for the API integration suite against an ISOLATED throwaway DB.
#
#     npm run test:api        # from the repo root
#
# Brings up the `db-test` compose service (a tmpfs Postgres on :55433 — separate
# container, port, and storage from your dev `db`), runs the migrate→boot→seed→test
# orchestration against it, then removes it. Your dev database is never touched.
#
# CI does the identical orchestration (dev/scripts/test/run-api-tests.js) against a
# GitHub Actions `postgres:16` service instead of this compose container.
#
# Requires Docker + Node. The host boots the API directly, so it installs api/
# deps once if they're missing.

set -euo pipefail

cd "$(dirname "$0")/../../.."   # repo root

TEST_PG_PORT="${TEST_POSTGRES_PORT:-55433}"
export DATABASE_URL="postgres://${POSTGRES_USER:-crm}:${POSTGRES_PASSWORD:-devpassword}@127.0.0.1:${TEST_PG_PORT}/${POSTGRES_DB:-crm}"
export TEST_API_PORT="${TEST_API_PORT:-3201}"

# Remove ONLY the db-test container on exit (never the dev stack). Preserve the
# real exit code so a test failure still gates `npm run test:api` / CI.
cleanup() {
  local code=$?
  echo "▸ removing isolated test database…"
  docker compose --profile test rm -sfv db-test >/dev/null 2>&1 || true
  exit "$code"
}
trap cleanup EXIT

# The host runs migrations + boots the API directly, so deps for api/ AND
# outreach/ must resolve — the API statically imports the outreach service.
# Chromium download is skipped (tests never launch a browser). One-time; cached
# in each node_modules. The pino canary catches a stale outreach install whose
# package.json gained deps after it was last built.
[ -d api/node_modules ] || npm --prefix api ci
[ -d outreach/node_modules/pino ] || PUPPETEER_SKIP_DOWNLOAD=true npm --prefix outreach ci

echo "▸ starting isolated test Postgres (db-test) on :${TEST_PG_PORT}…"
# --force-recreate guarantees a brand-new tmpfs (empty DB) every run, so the
# seed never trips its "refuse to seed on top of existing data" guard.
docker compose --profile test up -d --wait --force-recreate db-test

node dev/scripts/test/run-api-tests.js
