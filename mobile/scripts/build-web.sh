#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mobile_root="$(cd "$script_dir/.." && pwd)"
repo_root="$(cd "$mobile_root/.." && pwd)"
web_root="$mobile_root/CRAMMobile/Resources/Web"

npm_command=""
if [[ -n "${NPM_BIN:-}" && -x "${NPM_BIN}" ]]; then
  npm_command="${NPM_BIN}"
else
  for candidate in /opt/homebrew/bin/npm /usr/local/bin/npm /usr/bin/npm; do
    if [[ -x "$candidate" ]]; then
      npm_command="$candidate"
      break
    fi
  done
fi
if [[ -z "$npm_command" ]] && command -v npm >/dev/null 2>&1; then
  npm_command="$(command -v npm)"
fi
if [[ -z "$npm_command" ]]; then
  echo "CRAM Mobile requires Node.js 22.12+ and npm to build the shared renderer." >&2
  echo "Set NPM_BIN to the absolute path of npm if Xcode cannot find it." >&2
  exit 1
fi
if [[ ! -d "$repo_root/gui/node_modules" ]]; then
  echo "GUI dependencies are missing. Run: npm --prefix \"$repo_root/gui\" ci" >&2
  exit 1
fi

mkdir -p "$web_root"
"$npm_command" --prefix "$repo_root/gui" run build -- --outDir "$web_root"

if [[ ! -f "$web_root/index.html" ]]; then
  echo "The shared renderer build did not produce $web_root/index.html." >&2
  exit 1
fi

# Vite empties outDir before each build. Keep the tracked placeholder so the
# Xcode folder reference exists before its Run Script phase executes.
touch "$web_root/.gitkeep"
