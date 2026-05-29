#!/usr/bin/env bash
# Host-side local-LLM detection for CRAM.
#
# IMPORTANT: this runs on the HOST, never inside the container. The app always
# runs in a Linux container, so `uname` inside it always reports Linux even on
# a Mac — the host OS can only be detected out here. The chosen model is then
# passed into the container via AGENT_MODEL (setup.sh bakes it into .env;
# restart-prod.sh exports it before `docker compose up`).
#
# Model picked by host OS/arch — same Ollama, OS-optimized build:
#   Apple Silicon macOS (Darwin/arm64) -> <base>-mlx   (Ollama uses MLX there)
#   everything else (Linux, Intel Mac) -> <base>       (GGUF via llama.cpp)
#
# Usage:
#   ./scripts/detect-llm.sh                      # human output + checks; model on stdout
#   AGENT_MODEL=$(./scripts/detect-llm.sh -q)    # capture just the model tag
#   source ./scripts/detect-llm.sh               # get cram_detect_model / cram_check_ollama

# Base model tag (no -mlx suffix). Override to switch models everywhere.
CRAM_BASE_MODEL="${CRAM_BASE_MODEL:-gemma4:e4b}"
# Ollama address from the HOST's point of view (the container uses
# host.docker.internal instead; here we're on the host, so localhost).
CRAM_OLLAMA_HOST="${CRAM_OLLAMA_HOST:-http://localhost:11434}"

# Echo the OS-appropriate model tag for this host. Idempotent: adds/strips the
# -mlx suffix to match the platform regardless of how CRAM_BASE_MODEL is set.
cram_detect_model() {
  local os arch base="$CRAM_BASE_MODEL"
  os="$(uname -s)"
  arch="$(uname -m)"
  if [[ "$os" == "Darwin" && ( "$arch" == "arm64" || "$arch" == "aarch64" ) ]]; then
    case "$base" in
      *-mlx) echo "$base" ;;
      *)     echo "${base}-mlx" ;;
    esac
  else
    echo "${base%-mlx}"
  fi
}

# Best-effort, non-fatal: warn if Ollama isn't installed/running or the model
# isn't pulled. Always returns 0 so callers under `set -e` don't abort.
cram_check_ollama() {
  local model="$1"
  if ! command -v ollama >/dev/null 2>&1; then
    echo "  ! ollama not found on PATH — install it: https://ollama.com/download" >&2
    return 0
  fi
  if ! curl -fsS "$CRAM_OLLAMA_HOST/api/version" >/dev/null 2>&1; then
    echo "  ! Ollama isn't responding at $CRAM_OLLAMA_HOST — start it with: ollama serve" >&2
    return 0
  fi
  if ollama list 2>/dev/null | awk 'NR>1{print $1}' | grep -qx "$model"; then
    echo "  ✓ Ollama is up and '$model' is pulled." >&2
  else
    echo "  ! model '$model' is not pulled. Run: ollama pull $model" >&2
  fi
  return 0
}

# Run detection + checks when executed directly (skipped when sourced).
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  quiet=0
  [[ "${1:-}" == "-q" || "${1:-}" == "--quiet" ]] && quiet=1
  model="$(cram_detect_model)"
  if [[ "$quiet" == "0" ]]; then
    echo "Host $(uname -s)/$(uname -m) -> model: $model" >&2
    cram_check_ollama "$model"
  fi
  echo "$model"   # stdout = the model tag, so $(...) captures only this
fi
