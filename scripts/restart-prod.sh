#!/usr/bin/env bash
# Production restart: tears down running containers, pulls the latest code
# from git, and brings the stack back up with a fresh build. Run this on
# the host that's serving CRAM whenever you want to update to the latest
# version.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

bold() { printf '\033[1m%s\033[0m' "$1"; }
ok()   { printf '\033[32m%s\033[0m\n' "$1"; }
err()  { printf '\033[31m%s\033[0m\n' "$1" >&2; }

if ! command -v docker >/dev/null 2>&1; then
  err "docker is not installed or not on PATH."
  exit 1
fi

cd "$ROOT"

echo "$(bold "==> Tearing down running containers")"
docker compose --profile prod down

echo "$(bold "==> Pulling latest from git")"
git pull --ff-only

echo "$(bold "==> Detecting local LLM model for this host")"
# shellcheck source=scripts/detect-llm.sh
source "$ROOT/scripts/detect-llm.sh"
AGENT_MODEL="$(cram_detect_model)"; export AGENT_MODEL
echo "  $(uname -s)/$(uname -m) -> AGENT_MODEL=$AGENT_MODEL"
cram_check_ollama "$AGENT_MODEL"

echo "$(bold "==> Rebuilding and starting prod stack")"
docker compose --profile prod up -d --build

echo
ok "Restart complete."
docker compose --profile prod ps
