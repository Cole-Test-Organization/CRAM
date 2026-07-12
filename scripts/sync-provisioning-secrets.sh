#!/usr/bin/env bash
# Sync local broker provisioning secrets into a remote CRAM container.
#
# This does not copy the remote database or the AES master key. It streams the
# local allowlisted secret values to the remote container, then runs the app's
# provisioning:seed-secrets command there so the values are encrypted with the
# remote PROVISIONING_SECRETS_KEY and written to the remote provisioning_secrets
# table.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRET_SOURCE="$ROOT/api/src/services/provisioning/secrets/seedSecrets.ts"

DEFAULT_REMOTE="${CRAM_SYNC_REMOTE:-host.homelab}"
DEFAULT_ENV_FILE="${CRAM_SYNC_ENV_FILE:-$ROOT/.env}"
DEFAULT_CONTAINER="${CRAM_SYNC_CONTAINER:-cram}"

remote="$DEFAULT_REMOTE"
env_file="$DEFAULT_ENV_FILE"
container="$DEFAULT_CONTAINER"
container_explicit=false

usage() {
  cat <<EOF
Usage:
  scripts/sync-provisioning-secrets.sh [options]

Options:
  -r, --remote <host>       SSH host to update (default: $DEFAULT_REMOTE)
  -e, --env-file <path>     Local .env source (default: $DEFAULT_ENV_FILE)
  -c, --container <name>    Remote container (default: $DEFAULT_CONTAINER,
                            falls back to cram-dev when not set explicitly)
  -h, --help                Show this help

Environment overrides:
  CRAM_SYNC_REMOTE          Default remote SSH host
  CRAM_SYNC_ENV_FILE        Default local .env source
  CRAM_SYNC_CONTAINER       Default remote container

Example:
  scripts/sync-provisioning-secrets.sh
  scripts/sync-provisioning-secrets.sh --remote host.homelab --container cram
  npm run sync:provisioning-secrets -- --env-file ./local-broker.env
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -r|--remote)
      remote="${2:?missing value for $1}"
      shift 2
      ;;
    --remote=*)
      remote="${1#*=}"
      shift
      ;;
    -e|--env-file)
      env_file="${2:?missing value for $1}"
      shift 2
      ;;
    --env-file=*)
      env_file="${1#*=}"
      shift
      ;;
    -c|--container)
      container="${2:?missing value for $1}"
      container_explicit=true
      shift 2
      ;;
    --container=*)
      container="${1#*=}"
      container_explicit=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "sync-provisioning-secrets: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ! -r "$env_file" ]]; then
  echo "sync-provisioning-secrets: env file not readable: $env_file" >&2
  exit 1
fi

if [[ ! -r "$SECRET_SOURCE" ]]; then
  echo "sync-provisioning-secrets: cannot read secret allowlist: $SECRET_SOURCE" >&2
  exit 1
fi

if [[ ! "$container" =~ ^[A-Za-z0-9_.-]+$ ]]; then
  echo "sync-provisioning-secrets: unsafe container name: $container" >&2
  exit 1
fi

if ! command -v ssh >/dev/null 2>&1; then
  echo "sync-provisioning-secrets: ssh is not installed or not on PATH." >&2
  exit 1
fi

secret_keys=()
while IFS= read -r key; do
  secret_keys+=("$key")
done < <(
  awk '
    /BROKER_SECRET_KEYS/ { in_list = 1; next }
    in_list && /\];/ { exit }
    in_list {
      while (match($0, /"[A-Z][A-Z0-9_]*"/)) {
        print substr($0, RSTART + 1, RLENGTH - 2)
        $0 = substr($0, RSTART + RLENGTH)
      }
    }
  ' "$SECRET_SOURCE"
)

if [[ ${#secret_keys[@]} -eq 0 ]]; then
  echo "sync-provisioning-secrets: no broker secret keys found in $SECRET_SOURCE" >&2
  exit 1
fi

if ! ssh "$remote" "docker inspect '$container' >/dev/null 2>&1"; then
  if [[ "$container_explicit" == false ]] && ssh "$remote" "docker inspect 'cram-dev' >/dev/null 2>&1"; then
    container="cram-dev"
  else
    echo "sync-provisioning-secrets: remote container not found on $remote: $container" >&2
    exit 1
  fi
fi

unset_line="unset"
for key in "${secret_keys[@]}"; do
  unset_line+=" $key"
done

quote_for_shell() {
  printf "'"
  printf '%s' "$1" | sed "s/'/'\\\\''/g"
  printf "'"
}

remote_cmd=$(cat <<EOF
set -eu
: "\${DATABASE_URL:?remote container DATABASE_URL is not set}"
: "\${PROVISIONING_SECRETS_KEY:?remote container PROVISIONING_SECRETS_KEY is not set}"
tmp="\$(mktemp /tmp/cram-provisioning-secrets.XXXXXX.env)"
trap 'rm -f "\$tmp"' EXIT
cat > "\$tmp"
$unset_line
npm --prefix /app/api run provisioning:seed-secrets -- --env-file "\$tmp" --overwrite
npm --prefix /app/api run provisioning:list-secrets
EOF
)

filter_local_env() {
  local key_lines
  key_lines="$(printf '%s\n' "${secret_keys[@]}")"
  awk -v keys="$key_lines" '
    BEGIN {
      split(keys, key, "\n")
      for (i in key) {
        if (key[i] != "") allow[key[i]] = 1
      }
    }
    {
      line = $0
      sub(/\r$/, "", line)
      trimmed = line
      sub(/^[[:space:]]+/, "", trimmed)
      sub(/^export[[:space:]]+/, "", trimmed)
      if (trimmed == "" || trimmed ~ /^#/) next
      eq = index(trimmed, "=")
      if (!eq) next
      name = substr(trimmed, 1, eq - 1)
      gsub(/[[:space:]]/, "", name)
      if (allow[name]) print trimmed
    }
  ' "$env_file"
}

echo "sync-provisioning-secrets: pushing broker secrets from $env_file to $remote/$container"
echo "sync-provisioning-secrets: local values win for keys present in the local env file"

filter_local_env | ssh "$remote" "docker exec -i '$container' sh -c $(quote_for_shell "$remote_cmd")"
