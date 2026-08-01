#!/bin/bash
# FinDesk api-server launchd wrapper.
#
# launchd starts processes with a minimal environment: no shell profile, no
# nvm/homebrew PATH. This wrapper rebuilds the toolchain PATH, then execs the
# server so launchd supervises the actual node process (KeepAlive restarts it
# on crash).
#
# NOTE: .env is NOT sourced here — the server loads the root .env itself
# (src/loadEnv.ts, tolerant dotenv format with unquoted spaces). Sourcing it
# as bash would crash on the repo's own documented format, e.g.
# `SEC_USER_AGENT=Justin Legacy email@...`. We only check it exists.
#
# Fails loudly: FATAL goes to the err log AND to a macOS notification (this
# runs in the gui domain), so a permanently broken desk is seen on screen,
# not discovered days later in a log.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="$REPO/artifacts/api-server"
LOG_DIR="$HOME/Library/Logs/findesk"

fatal() {
  echo "FATAL: $1" >&2
  osascript -e "display notification \"$1\" with title \"FinDesk desk server DOWN\"" 2>/dev/null || true
  exit 78
}

# Toolchain PATH: homebrew (Apple Silicon + Intel), pnpm homes, and the
# NEWEST nvm-installed node (this repo documents `nvm use` as the install
# path — corepack-managed pnpm lives in the same bin dir).
NVM_BIN="$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1 || true)"
export PATH="${NVM_BIN:+$NVM_BIN:}/opt/homebrew/bin:/usr/local/bin:$HOME/Library/pnpm:$HOME/.local/share/pnpm:$PATH"

command -v node >/dev/null || fatal "node not on PATH for launchd (nvm dir searched: ~/.nvm/versions/node/*/bin)"
command -v pnpm >/dev/null || fatal "pnpm not on PATH for launchd"
[ -f "$REPO/.env" ] || fatal ".env missing at repo root — desk cannot run without keys/DATABASE_URL"

# Keep the append-only launchd logs bounded (macOS won't rotate custom files).
for f in "$LOG_DIR/api-server.out.log" "$LOG_DIR/api-server.err.log"; do
  if [ -f "$f" ] && [ "$(stat -f%z "$f" 2>/dev/null || echo 0)" -gt 10485760 ]; then
    tail -c 1048576 "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  fi
done

# Same mode as the operator's terminal. PORT is intentionally NOT exported:
# the server's own .env loader owns it (real env would override .env).
export NODE_ENV=development

cd "$APP"
# Always rebuild (esbuild, <1s): the running server can never drift from the
# checked-out code after a git pull.
pnpm run build >&2 || fatal "build failed — see api-server.err.log"

exec node --enable-source-maps ./dist/index.mjs
