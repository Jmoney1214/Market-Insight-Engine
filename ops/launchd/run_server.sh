#!/bin/bash
# FinDesk api-server launchd wrapper.
#
# launchd starts processes with a minimal environment: no shell profile, no
# nvm/homebrew PATH, no .env. This wrapper rebuilds that environment the same
# way the operator's `pnpm run dev` terminal does, then execs the server so
# launchd supervises the actual node process (KeepAlive restarts it on crash).
#
# Fails loudly to the error log — a half-configured desk must not run silently.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="$REPO/artifacts/api-server"

# Toolchain PATH: homebrew (Apple Silicon + Intel), pnpm home, system.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/Library/pnpm:$HOME/.local/share/pnpm:$PATH"

command -v node >/dev/null || { echo "FATAL: node not on PATH for launchd" >&2; exit 78; }
command -v pnpm >/dev/null || { echo "FATAL: pnpm not on PATH for launchd" >&2; exit 78; }

# Same env contract as the operator's terminal: root .env, dev mode, port 8080.
[ -f "$REPO/.env" ] || { echo "FATAL: $REPO/.env missing — desk cannot run without keys/DATABASE_URL" >&2; exit 78; }
set -a; source "$REPO/.env"; set +a
export NODE_ENV=development
export PORT="${PORT:-8080}"

cd "$APP"
# Always rebuild (esbuild, <1s): the running server can never drift from the
# checked-out code after a git pull.
pnpm run build >&2

exec node --enable-source-maps ./dist/index.mjs
