# TradingView MCP — max-utilization work order (LOCAL terminal)

**Date:** 2026-07-11 · **Runs in:** the local Claude Code terminal (the only
environment with the TradingView MCP connected — cloud sessions cannot do any
of this). Contract upgrades already shipped: tv-scanner (extended duties),
pine-reviewer (compile loop), backtest-runner (Strategy Tester crosscheck).

## Setup verification (one-time, do first)

1. Confirm the MCP entry (`~/.claude/mcp.json` or project `.mcp.json`) and
   that TradingView Desktop is running with the CDP debug port (9222).
2. Health check via the MCP (list tools / fetch a chart state). If not
   connected, install per the MCP repo README and re-verify. Local-only by
   design: CDP means the data never leaves the desk.

## The four duties (in value order)

### 1. Strategy Tester cross-validation — the second truth plane
Our engines' numbers have never been independently verified end-to-end
(backtest-runner's Rule-6 caveat, flagged twice in the Change-Protocol record).
Task: take the JUMPDAY_RIDER replay engine's canonical run (same symbols,
bars, window), express it in Pine (tools/pine/ has the twins; parity contract
in research/parity-audit.md), run TradingView's Strategy Tester through the
MCP, and record BOTH numbers as a typed finding. Gap <= ~1-2% (fill-model
noise) = verified, cite freely. Bigger gap = bug finding in one engine; blocks
citation until resolved. "Same bars, same window, same truth."

### 2. Pine compile loop
Every script in tools/pine/ gets compiled through the MCP; pine-reviewer's
static findings get compiler ground truth. Capture errors verbatim; attach
Strategy Tester summaries for strategy scripts.

### 3. Bar-replay paper sessions — forward-sample generator
Drive TV bar-replay on the shipped setups to produce timestamped paper
entries/exits (entry AND exit times — the data whose absence killed the H2
circuit-breaker test). Output: REPLAY-mode journal candidates with full
timestamps, human-confirmed before they count (THE WALL: nothing auto-writes
to journal_entries).

### 4. Morning sweep (the original tv-scanner duty — still unrun)
8:00–9:25 ET: pre-market gappers + rvol leaders, diffed against our 8:30
board, every TV claim re-verified on Alpaca SIP, disagreements logged as
findings. First live run is still owed.

## Hard line (non-negotiable)

Analysis MCPs only. Broker/order MCPs (Kite, Groww, Hyperliquid, or any
sibling) are banned in this shop no matter what tutorials demonstrate — no
order path, no execution code, the trigger stays human. TradingView numbers
never feed an engine, a badge, or a journal entry directly; Alpaca SIP remains
the price plane of record and human confirmation remains the journal gate.

## Cadence once verified

- Daily: morning sweep (8:00–9:25 ET); compile loop on any Pine diff.
- Weekly: one Strategy Tester cross-validation on the current canonical
  engine run; bar-replay paper sessions as forward-capture needs demand.
- All outputs: typed agent_findings rows (writer "tv-scanner" / local), graded
  by postflight like every other voice.
