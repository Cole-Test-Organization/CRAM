#!/usr/bin/env bash
# Interactive setup — walks a new operator through the required environment
# variables and writes a .env file at the repo root. Re-run any time; it
# prompts before overwriting an existing .env.
#
# All values are also settable directly via env vars (e.g. for CI / Docker /
# K8s deploys that skip this script). See .env.example for the full list.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"
TODOIST_ENV_FILE="$ROOT/todoist/.env"

bold() { printf '\033[1m%s\033[0m' "$1"; }
dim()  { printf '\033[2m%s\033[0m' "$1"; }
ok()   { printf '\033[32m%s\033[0m\n' "$1"; }
warn() { printf '\033[33m%s\033[0m\n' "$1"; }
err()  { printf '\033[31m%s\033[0m\n' "$1" >&2; }

prompt() {
  # $1 question  $2 default  → echoes the answer
  local q="$1" def="${2:-}" reply
  if [[ -n "$def" ]]; then
    read -r -p "$(bold "$q") [$(dim "$def")]: " reply || true
    echo "${reply:-$def}"
  else
    read -r -p "$(bold "$q"): " reply || true
    echo "$reply"
  fi
}

prompt_secret() {
  local q="$1" reply
  read -r -s -p "$(bold "$q") (input hidden, leave blank to skip): " reply || true
  echo
  echo "$reply"
}

random_password() {
  # 32 hex chars. Using openssl avoids the `tr < /dev/urandom | head -c N`
  # pattern, which dies under `set -euo pipefail` because head closes the pipe
  # and tr exits 141 (SIGPIPE), aborting the script silently.
  openssl rand -hex 16
}

detect_lan_ip() {
  # Best-effort primary LAN IPv4 of this host; prints an empty string if it
  # can't tell. Always call as `$(detect_lan_ip || true)` so a failure here
  # never aborts the script under `set -e`.
  local lan="" iface=""
  if [[ "$(uname -s 2>/dev/null)" == "Darwin" ]]; then
    iface=$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}') || true
    [[ -n "$iface" ]] && lan=$(ipconfig getifaddr "$iface" 2>/dev/null) || true
    [[ -n "$lan" ]] || lan=$(ipconfig getifaddr en0 2>/dev/null) || true
    [[ -n "$lan" ]] || lan=$(ipconfig getifaddr en1 2>/dev/null) || true
  else
    if command -v ip >/dev/null 2>&1; then
      lan=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}') || true
    fi
    [[ -n "$lan" ]] || lan=$(hostname -I 2>/dev/null | awk '{print $1}') || true
  fi
  printf '%s' "$lan"
}

if [[ -f "$ENV_FILE" ]]; then
  warn ".env already exists at $ENV_FILE"
  reply=$(prompt "Overwrite? (y/N)" "N")
  case "$reply" in
    y|Y|yes|YES) ;;
    *) echo "Aborted. Edit $ENV_FILE directly to change settings."; exit 0 ;;
  esac
fi

cat <<EOF

╔══════════════════════════════════════════════════════════╗
║   CRAM — Customer Relationship Agentic Manager           ║
║   Setup                                                  ║
╚══════════════════════════════════════════════════════════╝

This will write .env at the repo root. You can change anything later by
editing that file directly or re-running this script.

Press Enter to accept the default shown in brackets.

EOF

bold "Identity"; echo
echo "These shape the agent's system prompt and the workflow guidance the MCP server delivers to LLMs."
VENDOR_NAME=$(prompt "Your company / vendor name" "Acme Corp")
USER_ROLE=$(prompt "Your role" "Sales Engineer")
# Work email → internal domain. Contacts/attendees whose email matches this
# domain get flagged "internal" (skip account creation + outreach enrichment).
# Only the derived domain is persisted, never the full address.
USER_EMAIL=$(prompt "Your work email (its domain flags internal contacts)" "")
SELF_DOMAINS=""
if [[ -n "$USER_EMAIL" ]]; then
  # Strip the local part (everything up to the last @). A bare domain with no
  # @ is left untouched. Lowercased for a tidy .env; the API re-normalizes on
  # read regardless, so casing/whitespace here is not load-bearing.
  SELF_DOMAINS=$(printf '%s' "${USER_EMAIL##*@}" | tr '[:upper:]' '[:lower:]')
fi
echo

bold "Postgres"; echo
echo "The bundled Docker compose stack runs a local Postgres. Pick a strong password; it never leaves this machine."
POSTGRES_USER=$(prompt "Postgres user" "crm")
POSTGRES_DB=$(prompt "Postgres database name" "crm")
default_pw=$(random_password)
POSTGRES_PASSWORD=$(prompt "Postgres password" "$default_pw")
echo

bold "Network access"; echo
echo "By default CRAM listens on this machine only (http://localhost:3200). Answer Y to expose it on your LAN so other devices — your phone, laptop, MCP clients — can reach it. There's no auth layer yet, so only do this on a network you trust."
LAN_IP=$(detect_lan_ip || true)
if [[ -n "$LAN_IP" ]]; then
  echo "This machine's LAN address looks like $LAN_IP — once exposed, CRAM would be at http://$LAN_IP:3200."
fi
expose_lan=$(prompt "Expose CRAM to your LAN? (y/N)" "N")
case "$expose_lan" in
  y|Y|yes|YES) BIND_ADDRESS="0.0.0.0" ;;
  *)           BIND_ADDRESS="127.0.0.1" ;;
esac
echo

bold "Todoist (optional)"; echo
echo "Todoist is the bundled task manager. Answer N to skip the integration entirely — no HTTP routes, no MCP tools, no agent guidance about Todoist will be loaded."
use_todoist=$(prompt "Do you use Todoist? (y/N)" "N")
case "$use_todoist" in
  y|Y|yes|YES)
    TODOIST_ENABLED=true
    TODOIST_API_TOKEN=$(prompt_secret "Todoist API token")
    TODOIST_DEFAULT_PROJECT=$(prompt "Todoist default project for new tasks" "Inbox")
    TODOIST_DEFAULT_SECTION=$(prompt "Todoist default section (leave blank for project root)" "")
    ;;
  *)
    TODOIST_ENABLED=false
    TODOIST_API_TOKEN=""
    TODOIST_DEFAULT_PROJECT=""
    TODOIST_DEFAULT_SECTION=""
    ;;
esac
echo

bold "Agent LLM"; echo
echo "The agent runs on a local LLM via Ollama. You don't set a model here — once running, the app uses your pick from Settings → Agent LLM, or auto-selects one from whatever models your Ollama has installed. Just make sure Ollama is running and you've pulled a model (e.g. 'ollama pull gemma4:12b')."
echo

# Write .env at repo root
{
  cat <<EOF
# CRAM — generated by scripts/setup.sh on $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Re-run scripts/setup.sh to regenerate, or edit by hand.

# Identity
VENDOR_NAME="$VENDOR_NAME"
USER_ROLE="$USER_ROLE"

# Internal email domains (comma-separated). Attendees/contacts from these
# domains are flagged "internal" — skipped for account creation and outreach.
# Seeded from your email above; acts as a bootstrap default until you curate
# the list in Settings -> Internal Domains. (INTERNAL_DOMAINS is an alias.)
SELF_DOMAINS="$SELF_DOMAINS"

# Postgres
POSTGRES_USER=$POSTGRES_USER
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=$POSTGRES_DB
DATABASE_SSL=false

# Network access — host interface the app's published ports (3200 GUI/API,
# 3100 MCP) bind to. 127.0.0.1 = this machine only; 0.0.0.0 = exposed on the
# LAN. (Postgres always stays bound to 127.0.0.1.) Re-run setup.sh to change.
BIND_ADDRESS=$BIND_ADDRESS

# Agent LLM — runs on a local LLM (Ollama by default). The model is chosen in
# the GUI (Settings -> Agent LLM) per user; if unset, the app auto-selects one
# from the models your Ollama has installed. No AGENT_MODEL needed here.
# Point LOCAL_BASE_URL at a LAN box to use an LLM on another machine:
# LOCAL_BASE_URL=http://192.168.1.50:11434

# Todoist
EOF
  # When disabled, write the explicit flag. When enabled, omit the flag (default
  # is true at runtime) and write the token + defaults so docker-compose can
  # interpolate them into the container env.
  if [[ "$TODOIST_ENABLED" == "false" ]]; then
    echo "TODOIST_ENABLED=false"
  else
    echo "TODOIST_API_TOKEN=$TODOIST_API_TOKEN"
    echo "TODOIST_DEFAULT_PROJECT=\"$TODOIST_DEFAULT_PROJECT\""
    echo "TODOIST_DEFAULT_SECTION=\"$TODOIST_DEFAULT_SECTION\""
  fi
} > "$ENV_FILE"

chmod 600 "$ENV_FILE"
ok "Wrote $ENV_FILE"

# Pre-create the host paths that docker-compose bind-mounts as files. If these
# don't exist on the host before `docker compose up`, Docker creates empty
# directories at the mount points and the outreach module crashes trying to
# read them as JSON files.
mkdir -p "$ROOT/backups" "$ROOT/outreach"
[[ -e "$ROOT/outreach/cookies.json"    ]] || echo '[]' > "$ROOT/outreach/cookies.json"
[[ -e "$ROOT/outreach/.ratelimit.json" ]] || echo '{}' > "$ROOT/outreach/.ratelimit.json"

# Write todoist/.env if the user provided a token (the todoist module reads its
# token from its own .env, not the root one)
if [[ -n "$TODOIST_API_TOKEN" ]]; then
  mkdir -p "$ROOT/todoist"
  cat > "$TODOIST_ENV_FILE" <<EOF
TODOIST_API_TOKEN=$TODOIST_API_TOKEN
EOF
  chmod 600 "$TODOIST_ENV_FILE"
  ok "Wrote $TODOIST_ENV_FILE"
fi

# Build the GUI-access line for the summary based on the chosen bind address.
if [[ "$BIND_ADDRESS" == "0.0.0.0" ]]; then
  if [[ -n "$LAN_IP" ]]; then
    access_line="Open the GUI at http://localhost:3200 (this machine) or http://$LAN_IP:3200 (other devices on your LAN)"
  else
    access_line="Open the GUI at http://localhost:3200, or http://<this-machine-ip>:3200 from your LAN"
  fi
else
  access_line="Open the GUI at http://localhost:3200 — this machine only (set BIND_ADDRESS=0.0.0.0 in .env to expose on your LAN)"
fi

cat <<EOF

$(bold "Next steps:")

  1. Start the stack:
       docker compose --profile prod up -d --build

  2. $access_line

  3. (Optional) Capture LinkedIn cookies to enable persona research — background
     enrichment of the people you sell to, plus company/industry lookups. Needs
     Node.js 20+; run from a machine with a desktop browser and log in when the
     window opens:
       cd outreach && npm install && node src/index.js login
     This writes outreach/cookies.json. If your CRAM host is headless, run it on
     your laptop and copy that file to the same path on the host. Persona research
     stays off until these cookies exist; re-run when the session expires.

  4. To update later (pull latest code and restart with a fresh build):
       ./scripts/restart-prod.sh

EOF
