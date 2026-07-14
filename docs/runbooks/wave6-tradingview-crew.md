# Wave 6 — TradingView crew

The operator-facing crew that connects the desk's deterministic strategy engine
to TradingView, on the operator's Mac, through the `tradingview` MCP server.
TradingView is a **visual lab and alert rail — permanently outside strategy
truth** (ADR 0002). The Node engine owns behavior; the crew keeps TradingView
faithful to it.

## The loop

```
STRATEGY_SPEC  ── single source of every strategy constant
   │  (bound by pine_node_consistency.test.mjs — CI gate)
   ├──► Node engine (engine.mjs)        ── backtest truth, live scan
   └──► Pine twins (tools/pine/*.pine)  ── what runs in TradingView

pine-twin-writer   WRITE  → transcribes engine→Pine, passes the structural lock
pine-reviewer      REVIEW → repaint / na-poison / v5-leftover / session review
tv-cockpit         PROVE  → inject in TV, pull trades, parity-diff vs Node
tv-alerts          NOTIFY → gated long signal → TradingView alert (the rail)
```

A twin only earns trust after all three gates: the **structural lock** (constants
match the spec), a **pine-reviewer SHIP**, and a **cockpit PARITY OK** (same
trades as the engine). Drift at any gate is a bug, never a wave-through.

## Members

| Member | Type | Where | Job |
|---|---|---|---|
| `pine-twin-writer` | agent | `.claude/agents/` | Generate/sync the Pine twin from the Node engine |
| `pine-reviewer` | agent | `.claude/agents/` | Catch repaint / na-poison / v5 / session bugs (pre-existing) |
| `tv-cockpit` | skill | `.claude/skills/` | Drive the MCP: inject, run tester, pull trades, parity |
| `tv-alerts` | skill | `.claude/skills/` | Gated long signal → TradingView alert |

## Banned surfaces (enforced by convention + review)

- **`ui_evaluate`** on `tradingview-mcp` — never-use (arbitrary DOM/JS eval).
- **Broker / order authority** — none, ever (ADR 0001). Pine `strategy.*` drives
  the backtester only; alerts notify a human.
- **Short entries** — long-only product invariant. A bearish read is a NO-ENTRY.
- **Non-TradingView alert channels** (e.g. Telegram) — TradingView is the rail.

## Preconditions (operator's Mac)

1. TradingView Desktop launched with the debug port:
   `open -a TradingView --args --remote-debugging-port=9222`
   (verify: `curl -s http://localhost:9222/json/version` returns JSON).
2. `tradingview` MCP connected (`claude mcp list` → ✔).

## CI guard

`tools/research/test/pine_node_consistency.test.mjs` fails the build if any Pine
constant drifts from `STRATEGY_SPEC` or the Node engine — the automated form of
pine-reviewer checklist #6. The live inject/parity loop runs on the operator's
Mac (the MCP needs the desktop app); the structural lock runs everywhere.
