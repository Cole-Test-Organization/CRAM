#!/usr/bin/env bash
# Production restart: tears down running containers, pulls the latest code
# from git, and brings the stack back up with a fresh build.
#
# Safe to run from either machine. It reads LOG_ENV_LABEL from .env to decide
# which host it is on: on the prod host it restarts locally, and on a dev host
# it re-runs itself over SSH on the prod host rather than rebuilding the dev
# stack (which would blow away the observability profiles and bind mounts).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# The prod host. Carries an explicit user because this is a bare IP — there's no
# ssh_config Host entry to supply one, and ssh would otherwise try the local
# username. Override either with CRAM_PROD_REMOTE / CRAM_PROD_ROOT.
REMOTE="${CRAM_PROD_REMOTE:-hcwilk@10.161.120.221}"
REMOTE_ROOT="${CRAM_PROD_ROOT:-~/cram}"

bold() { printf '\033[1m%s\033[0m' "$1"; }
ok()   { printf '\033[32m%s\033[0m\n' "$1"; }
warn() { printf '\033[33m%s\033[0m\n' "$1" >&2; }
err()  { printf '\033[31m%s\033[0m\n' "$1" >&2; }

# LOG_ENV_LABEL as this host declares it. Last assignment wins, quotes and
# inline comments stripped. Empty when .env is missing or the key is unset.
env_label() {
  [[ -f "$ROOT/.env" ]] || return 0
  sed -n 's/^[[:space:]]*LOG_ENV_LABEL[[:space:]]*=[[:space:]]*//p' "$ROOT/.env" \
    | sed -e 's/[[:space:]]*#.*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/" \
    | tail -1 \
    | tr -d '[:space:]'
}

LABEL="$(env_label)"

# ── dev host: hand off to prod over SSH ────────────────────────────────────
# CRAM_PROD_NO_HOP is set on the remote invocation below so a prod host whose
# .env is mislabelled can't bounce the command straight back and ssh-loop.
if [[ "$LABEL" != "prod" && "${CRAM_PROD_NO_HOP:-}" != "1" ]]; then
  if [[ -z "$LABEL" ]]; then
    warn "No LOG_ENV_LABEL in .env — assuming this is not the prod host."
  fi

  if ! command -v ssh >/dev/null 2>&1; then
    err "ssh is not installed or not on PATH."
    exit 1
  fi

  # Prod rebuilds from git, not from this working tree. Unpushed commits here
  # would silently produce a "successful" restart of stale code.
  if git -C "$ROOT" rev-parse --abbrev-ref '@{upstream}' >/dev/null 2>&1; then
    unpushed="$(git -C "$ROOT" rev-list --count '@{upstream}..HEAD' 2>/dev/null || echo 0)"
    if [[ "$unpushed" != "0" ]]; then
      warn "$unpushed local commit(s) are not pushed — prod pulls from git and will not include them."
    fi
  fi
  if [[ -n "$(git -C "$ROOT" status --porcelain 2>/dev/null)" ]]; then
    warn "Working tree has uncommitted changes — they will not reach prod."
  fi

  echo "$(bold "==> This host is '${LABEL:-unlabelled}' — restarting prod on $REMOTE:$REMOTE_ROOT")"
  exec ssh -t "$REMOTE" "cd $REMOTE_ROOT && CRAM_PROD_NO_HOP=1 ./scripts/restart-prod.sh"
fi

# ── prod host: restart locally ─────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  err "docker is not installed or not on PATH."
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
