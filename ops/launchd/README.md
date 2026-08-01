# Desk server auto-start (launchd)

Phase C1 of operational reliability: the api-server runs as a macOS launchd
user agent — **no terminal window, survives reboots, restarts on crash**. This
directly fixes the desk's measured failure mode: only 5 of 13 trading days
recorded in July 2026, every gap traced to "the server wasn't running."

## Install (on the operator's Mac, one paste)

```bash
cd /Users/justinetwaru/Projects/Market-Insight-Engine
git pull origin main
bash ops/launchd/install.sh
```

The installer is self-verifying: it builds once, registers the agent, then
polls `/healthz` and prints **SUCCESS** or the actual error-log tail. It is
idempotent — re-run it any time (e.g. after a `git pull`) to restart onto the
new code.

## How it works

| Piece | Job |
|---|---|
| `run_server.sh` | Rebuilds launchd's minimal environment like the operator's terminal: toolchain PATH, root `.env`, `NODE_ENV=development`, `PORT=8080`. Rebuilds `dist/` on every start (esbuild, <1s) so the process can never drift from the checkout, then `exec`s node so launchd supervises the real server process. |
| `com.findesk.api-server.plist.template` | `RunAtLoad` (start at login/boot) + `KeepAlive` (restart on any exit) + 15s `ThrottleInterval` (a hard-broken build backs off instead of spin-looping). The installer bakes in absolute paths — launchd cannot expand variables. |
| `install.sh` | Precondition checks → deps + build → plist render + lint → `bootout`/`bootstrap`/`kickstart` → health verification with error-log tail on failure. Kills any manually-started server holding the port first. |
| `uninstall.sh` | Deregisters the agent, keeps logs. |

## Day-2 operations

```bash
# Is it running / how many times has it restarted?
launchctl print gui/$(id -u)/com.findesk.api-server | grep -E "state|pid|runs"

# Live logs
tail -f ~/Library/Logs/findesk/api-server.out.log
tail -f ~/Library/Logs/findesk/api-server.err.log

# Deploy new code
git pull origin main && bash ops/launchd/install.sh

# Restart without deploying
launchctl kickstart -k gui/$(id -u)/com.findesk.api-server
```

## Notes

- User agent (`gui/` domain): starts at **login**, not headless boot. If the
  Mac reboots overnight it must reach the login session for the agent to run —
  enable automatic login (or FileVault-delayed login stays a manual step).
  Also disable system sleep during market hours (Energy Saver → prevent
  automatic sleeping, or `caffeinate` — a sleeping Mac runs nothing).
- The scan scheduler inside the server is already time-of-day aware
  (07:00–16:00 ET refresh, 08:15–09:30 record, after-close grading), so a
  boot at any hour does the right thing.
- The wrapper rebuilds `dist/` on **every** start — including crash restarts.
  A `git pull` without re-running the installer therefore gets silently
  deployed on the next restart; pull only when you intend the code to go live,
  and prefer `git pull && bash ops/launchd/install.sh` as the deploy ritual.
- Permanent failures (missing node/.env, broken build) post a **macOS
  notification** ("FinDesk desk server DOWN") in addition to the error log,
  and logs self-truncate at ~10MB so unattended months can't fill the disk.
- If you ever delete `~/Library/Logs/findesk/`, re-run the installer — launchd
  loses the job's output files until they're recreated.
