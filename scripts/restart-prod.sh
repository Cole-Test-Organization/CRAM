#!/usr/bin/env bash
# Production restart: tears down running containers, pulls latest from git,
# and brings the stack back up with a fresh build. Intended for prod hosts
# only — refuses to run unless .env has LOG_ENV_LABEL=prod.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"

bold() { printf '\033[1m%s\033[0m' "$1"; }
ok()   { printf '\033[32m%s\033[0m\n' "$1"; }
warn() { printf '\033[33m%s\033[0m\n' "$1"; }
err()  { printf '\033[31m%s\033[0m\n' "$1" >&2; }

if [[ ! -f "$ENV_FILE" ]]; then
  err "No .env found at $ENV_FILE. Run scripts/setup.sh first."
  exit 1
fi

LOG_ENV_LABEL="$(grep -E '^LOG_ENV_LABEL=' "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"

if [[ "$LOG_ENV_LABEL" != "prod" ]]; then
  err "LOG_ENV_LABEL is '${LOG_ENV_LABEL:-<unset>}', not 'prod'."
  err "This script only runs on prod hosts. Aborting."
  exit 1
fi

cd "$ROOT"

echo "$(bold "==> Tearing down running containers")"
docker compose --profile prod down

echo "$(bold "==> Pulling latest from git")"
git pull --ff-only

echo "$(bold "==> Rebuilding and starting prod stack")"
docker compose --profile prod up -d --build

echo
ok "Restart complete."
docker compose --profile prod ps
