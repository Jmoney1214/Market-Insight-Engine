---
name: tv-cockpit
description: >
  Drive TradingView through the tradingview-mcp server to inject a reviewed Pine
  twin, run the strategy tester, pull its trades, and prove parity against the
  Node engine. Use on the operator's Mac when they say "run this in TradingView",
  "cockpit SYMBOL", or want to verify a Pine twin fires the same trades as the
  desk. Requires TradingView Desktop launched with --remote-debugging-port=9222.
---

# tv-cockpit

Operate TradingView as the visual lab for a strategy the **Node engine already
owns**. TradingView never becomes strategy truth (ADR 0002); this skill sets up
the chart, runs the tester, and hands the trades to the deterministic parity
harness for a verdict.

## Preconditions (verify first, in order)

1. TradingView Desktop is running with the debug port open:
   `curl -s http://localhost:9222/json/version` must return JSON. If not, tell
   the operator to quit TradingView and run:
   `open -a TradingView --args --remote-debugging-port=9222`
2. The `tradingview` MCP server is connected (`claude mcp list` → ✔). Its tools
   are prefixed `mcp__tradingview__` (or similar) — discover them with ToolSearch.
3. The Pine twin has passed **both** upstream gates: the structural lock
   (`node --test tools/research/test/pine_node_consistency.test.mjs`) and a
   `pine-reviewer` SHIP verdict. If either is unverified, stop and say so.

## BANNED — never use

- **`ui_evaluate`** on the MCP. Arbitrary DOM/JS evaluation is a never-use
  surface (standing operator rule). Use only the named chart/data/pine tools.
- Any tool that would place a broker order. This is a backtest cockpit only.

## Procedure

1. **Set the chart** via the MCP's chart tools: symbol, 5-minute timeframe,
   **extended hours ON** (the pre-market gap logic needs it), and the date range
   requested.
2. **Load the twin**: read `tools/pine/<twin>.pine`, apply it to the chart via
   the MCP's pine/script tool. Confirm it compiled (no Pine errors returned).
3. **Read the tester**: pull the strategy results and the full trade list via
   `data_get_trades`. NOTE the cap: `data_get_trades` returns ~20 orders/call —
   if `strategy_results.total_trades` exceeds what you pulled, page until you
   have them all, or the parity run is on partial data (the harness hard-fails
   on this, by design).
4. **Save the dump** to a temp JSON file exactly as the MCP returned it.
5. **Run parity** against the Node engine on the SAME range:
   ```
   cd tools/research && node tv_parity_check.mjs \
     --trades <dump.json> --symbol SYM --from YYYY-MM-DD --to YYYY-MM-DD \
     --class rider|scalper
   ```
6. **Report the verdict**: PARITY OK / DRIFT / HARD FAIL, with the mismatch
   lines. DRIFT or HARD FAIL means the Pine twin and the desk's engine disagree
   — that is a bug to fix in the twin (or the spec), never something to wave
   through. The desk may only trust a twin that matches the engine it backtested.

Alpaca SIP stays the only bar source for the Node side; TradingView supplies
only the trades to verify. Trades are matched by chronological sequence (the MCP
dump has no timestamps).
