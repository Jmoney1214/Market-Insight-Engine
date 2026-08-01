#!/bin/bash
# FinDesk desk-server auto-start installer (one paste, self-verifying).
#
#   bash ops/launchd/install.sh
#
# After this, the api-server:
#   - starts automatically at login/boot,
#   - restarts itself if it crashes (15s backoff),
#   - logs to ~/Library/Logs/findesk/,
#   - never needs a terminal window kept open again.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LABEL="com.findesk.api-server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGDIR="$HOME/Library/Logs/findesk"
UID_N="$(id -u)"

echo "==> FinDesk launchd install from: $REPO"

# 0. Preconditions — fail loudly before touching launchd.
[ -f "$REPO/.env" ] || { echo "FATAL: $REPO/.env missing (keys + DATABASE_URL). Aborting."; exit 1; }
command -v pnpm >/dev/null || { echo "FATAL: pnpm not found in this shell. Aborting."; exit 1; }

# PORT single source of truth: the server reads .env itself (last assignment
# wins, value = everything after the first '='). Mirror that here so the kill
# target and the health poll always match the server's actual port.
PORT_CHECK="$(grep -E '^PORT=' "$REPO/.env" | tail -1 | cut -d= -f2- | tr -d '[:space:]')"
PORT_CHECK="${PORT_CHECK:-8080}"

# Preflight the WRAPPER's own toolchain resolution under a launchd-bare
# environment (no shell profile). If node/pnpm are invisible there, the agent
# would crash-loop even though this interactive shell sees them fine.
echo "==> Preflight: toolchain visibility under launchd's bare environment"
if ! env -i HOME="$HOME" /bin/bash -c '
  NVM_BIN="$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1 || true)"
  export PATH="${NVM_BIN:+$NVM_BIN:}/opt/homebrew/bin:/usr/local/bin:$HOME/Library/pnpm:$HOME/.local/share/pnpm:/usr/bin:/bin"
  command -v node >/dev/null && command -v pnpm >/dev/null
'; then
  echo "FATAL: node/pnpm are NOT visible on the PATH launchd will use."
  echo "       (Your shell profile makes them visible here, but launchd never loads it.)"
  echo "       Fix: install node via homebrew, or keep an nvm version under ~/.nvm/versions/node/."
  exit 1
fi

# 1. Deps + a build now, so first boot is instant and failures surface HERE.
echo "==> Installing deps + building once"
( cd "$REPO" && pnpm install --frozen-lockfile >/dev/null )
( cd "$REPO/artifacts/api-server" && pnpm run build >/dev/null )

# 2. Logs dir + executable wrapper.
mkdir -p "$LOGDIR" "$HOME/Library/LaunchAgents"
chmod +x "$REPO/ops/launchd/run_server.sh"

# 3. Bake real paths into the plist (launchd cannot expand variables).
sed -e "s|__REPO__|$REPO|g" -e "s|__HOME__|$HOME|g" \
  "$REPO/ops/launchd/com.findesk.api-server.plist.template" > "$PLIST"
plutil -lint "$PLIST" >/dev/null

# 4. (Re)register with launchd. bootout is idempotent cleanup of any old copy;
#    the port-kill clears a manually-started server BEFORE bootstrap starts the
#    managed one (RunAtLoad starts it — no kickstart needed, no double build).
echo "==> Registering $LABEL with launchd"
launchctl bootout "gui/$UID_N/$LABEL" 2>/dev/null || true
lsof -ti:"$PORT_CHECK" | xargs kill -9 2>/dev/null || true
launchctl bootstrap "gui/$UID_N" "$PLIST"

# 5. Verify: poll /api/healthz for up to 90s (first boot includes a build).
echo "==> Waiting for the server to come up on port $PORT_CHECK"
for i in $(seq 1 30); do
  sleep 3
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "localhost:$PORT_CHECK/api/healthz" || true)"
  if [ "$CODE" = "200" ]; then
    echo ""
    echo "=========================================="
    echo "  SUCCESS — desk server is INSTALLED and UP"
    echo "  http://localhost:$PORT_CHECK  (/api/healthz: 200)"
    echo "  Auto-starts at boot. Auto-restarts on crash."
    echo "  Logs: $LOGDIR/api-server.{out,err}.log"
    echo "=========================================="
    exit 0
  fi
done

echo ""
echo "=========================================="
echo "  FAILED — server did not answer /api/healthz within 90s."
echo "  Last 20 error-log lines:"
echo "------------------------------------------"
tail -20 "$LOGDIR/api-server.err.log" 2>/dev/null || echo "(no error log yet)"
echo "=========================================="
exit 1
