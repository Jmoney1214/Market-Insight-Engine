# FMFC Position Watch — Design (2026-07-31)

**Goal:** Constantly check the FMFC (Kandal M Venture) OPEN position — 5,000 sh @ $0.66,
down ~50% — from Friday post-market through **Monday 2026-08-03 open**, when the watch retires.
Robust to Claude's session dying over the weekend.

## Constraint that shapes everything
Claude's session is ephemeral (dies/reaped), cron is session-only, and setting TradingView
alerts via MCP failed (`price_set:false`). So "constant" checking = a **layered mix**, not one
always-on watcher. The durable core is a repo script + Jay-set TV alerts.

## Approved decisions
- **Horizon:** Option C robustness, scoped to retire at Monday's open.
- **Triggers (Option A — decision levels only):** break **$0.30** down (→ base ~$0.23) OR
  reclaim **$0.41** up (EMA9, real bounce); plus any reverse-split / dilution filing.
  Everything else = quiet background logging + research/social sweeps.

## Architecture — 4 layers × 3 regimes
| Layer | Tonight (→8pm) | Weekend (closed) | Monday (premkt→9:30) | Durable? |
|---|---|---|---|---|
| ① `watch_fmfc.mjs` | you/me run | you run anytime | you/me run | ✅ survives session death |
| ② TV alerts $0.30/$0.41 | — | armed | armed | ✅ Jay sets (MCP can't) |
| ③ Claude live loop + research | ✅ | when awake | ✅ if alive | ❌ ephemeral |
| ④ Cron reminder | — | — | Mon 9:30 (job dd5a6aa0) | best-effort |

## Component ① `tools/router/watch_fmfc.mjs` (BUILT)
One-shot: `node --env-file=.env tools/router/watch_fmfc.mjs [SYM=FMFC]`. Prints:
live price + bid/ask spread (real exit cost) from Alpaca **v2** snapshot (feed=sip); P&L off
`scans/open_positions.jsonl`; distance to $0.30/$0.41 with TRIGGERED flags; **reverse-split
guard** (price > $1.50 ⇒ likely 1-for-16 split, dollar P&L unchanged, split-adjusts the math);
latest 5 Alpaca news headlines + manual filing links. Generalizes to any OPEN position/symbol.

## Why this ticker is high-risk (the watch is defensive, not opportunistic)
Busted $4 IPO down ~97%; no-catalyst low-float pump (190M vol vs 18.3M shares) that round-tripped
$1.17→lows; **$25M ATW convertible facility ($23M undrawn, $0.065 floor) + 30.77M-share resale
shelf**; **1-for-16 reverse split approved, implementable any day thru Sept 30**; NASDAQ delisting
risk; Rosen class-action probe; ~1.4% short interest = no squeeze fuel. Monday base case: bleed
toward $0.22–0.25.

## Retire criteria
Monday's open decision made → log the outcome (close position in `open_positions.jsonl` +
`disc_log.mjs`), delete TV alerts, done.
