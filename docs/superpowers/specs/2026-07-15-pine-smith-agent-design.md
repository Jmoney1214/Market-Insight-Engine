# pine-smith — Design Spec

**Date:** 2026-07-15
**Status:** Approved design → implementation plan
**Owner:** Jay (Market-Insight-Engine)

## 1. Purpose

`pine-smith` is a Claude Code subagent that **generates, fixes/migrates, ports, and reviews TradingView Pine Script v6**, and closes the compile loop **live on the user's chart** via the TradingView MCP. It is the conversational "Pine expert you talk to." It produces both **indicators** and **backtestable `strategy()` scripts with real buy/sell orders**, and it adapts every script to the **instrument class** of the ticker being traded (a mega-cap like NVDA is treated differently from a low-priced penny mover).

It orchestrates nothing fragile: it carries its own expertise, but all *rules* live in a shared knowledge pack that the existing `pine-reviewer` agent also reads (one source of truth). For Node→Pine ports it follows the existing `pine-twin-writer` transcription discipline.

### Decisions locked in brainstorming
1. **Form:** Claude Code subagent (`.claude/agents/pine-smith.md`).
2. **Jobs:** Generate new · Fix & migrate · Port Node→Pine twin · Review/explain (all four).
3. **Autonomy:** Closes the compile loop automatically (write → inject → compile → read errors → self-fix → loop → self-review → present).
4. **Architecture:** Self-contained agent + shared `tools/pine/reference/` rule pack (Approach A).

## 2. Where everything is stored (file inventory)

```
.claude/agents/
  pine-smith.md                 # the agent definition (system prompt, tools, model)
  pine-reviewer.md              # EXISTING — updated to read the shared checklist below
  pine-twin-writer.md           # EXISTING — referenced by the Port mode

tools/pine/
  reference/                    # NEW shared knowledge pack (read by pine-smith AND pine-reviewer)
    README.md                   # index of the pack + how to keep it current
    pine-v6-core.md             # v6 language semantics & structure
    pine-v6-2026-features.md    # 2026 additions (request.footprint(), multiline strings, UDT sort, plot linestyles)
    pine-object-limits.md       # max_lines/boxes/labels/polylines caps + "too many drawings" fix
    pine-correctness-checklist.md   # SHARED rules extracted from pine-reviewer (na/repaint/session/RTH/v6/lookahead)
    instrument-classes.md       # NEW — ticker archetypes → Pine parameter defaults & guardrails
    strategy-backtest.md        # NEW — strategy() orders, realistic fills, Strategy-Tester + Node parity
    troubleshooting.md          # "Script could not be translated" blob fix, load errors
    patterns/
      orb-v6.md                 # modern ORB reference pattern
      vwap-ema-scalp-v6.md      # (starter) liquid-name intraday pattern
    sources.md                  # research citations
    research-2026-07-15.md      # full Pine-2026 research report (verbatim, with verification flags)

tools/pine/*.pine               # EXISTING 7 scripts — pine-smith can read/fix/review these
tools/research/                 # EXISTING Node engine — Port mode reads engine.mjs + STRATEGY_SPEC
```

Nothing about the agent lives outside the repo — the whole thing is version-controlled. The knowledge pack is plain markdown so it is diffable, reviewable, and updated as Pine evolves.

## 3. Knowledge base — contents

The pack is the agent's grounding (the research found **no usable v6 dataset/model on Hugging Face**, so authoritative knowledge is curated from TradingView's v6 manual + release notes, not fine-tunes).

| File | Holds | Notes |
|---|---|---|
| `pine-v6-core.md` | v6 semantics (strict booleans, `1/2 = 0.5`, `var`/`varip`, series vs simple, `indicator()`/`strategy()` structure, common `ta.*`/`math.*`/`request.*`), idioms | The "don't hallucinate v5" guardrail |
| `pine-v6-2026-features.md` | `request.footprint()` + `footprint`/`volume_row` types & accessors (**flagged: Premium-gated + verify accessor spellings in the manual**), multiline `"""` strings, UDT `sort_field`, `plot` `linestyle`, `time()` `timeframe_bars_back` | Only used when actually relevant |
| `pine-object-limits.md` | `max_lines_count`/`max_boxes_count`/`max_labels_count` (default 50, max 500), `max_polylines_count` (max 100), the "Too many drawings, cannot clean oldest" runtime error, mitigation (recycle a fixed pool, cap sessions/rows, bound lookback) | **Directly fixes the Leviathan failure** |
| `pine-correctness-checklist.md` | na-poisoning, repainting, `request.security` lookahead, session/RTH assumptions, fill-relative exits, v5 leftovers | **Shared** — `pine-reviewer` is updated to point here; single source of truth |
| `instrument-classes.md` | Ticker archetypes → parameter defaults & guardrails (see §4) | The NVDA-vs-penny requirement |
| `strategy-backtest.md` | `strategy()` orders, realistic commission/slippage, Strategy-Tester reading, Node parity (see §5) | The backtestable-orders requirement |
| `troubleshooting.md` | "Script could not be translated from `|B|…|E|`" = stale/corrupted **compiled blob** → re-save source / remove-&-re-add / hard-refresh; other load errors | Explains the ORB Matrix death |
| `patterns/*.md` | Reference implementations (ORB, VWAP/EMA scalp) with object-limit-safe plotting and alerts | Seeds, not copy-paste |
| `research-2026-07-15.md` + `sources.md` | The verbatim research report + citations | Provenance |

## 4. Instrument-class awareness (NVDA ≠ penny stock)

**Why:** the same logic needs different parameters, order types, stop bases, and backtest realism depending on the instrument. A tight 5-second scalp with 1-tick slippage is realistic on NVDA and fantasy on a thin $3 mover.

**Archetypes in `instrument-classes.md`** (each maps to concrete Pine defaults + guardrails):

| Class | Examples | Behavioral traits | Pine defaults the agent picks |
|---|---|---|---|
| Mega/large-cap liquid equity | NVDA, AAPL, SPY, QQQ | tight spread, deep book, small %/day moves, `mintick` 0.01 | ATR- or point-based stops; sec–min timeframes OK; low slippage (≈1 tick) + small per-share commission; VWAP/EMA/ORB all valid |
| Mid-cap equity | ~$10–100, moderate volume | moderate spread/liquidity | ATR stops; minute charts; moderate slippage |
| Low-priced / small-cap mover / penny | OI ($9), ELVA ($11), sub-$5 | **wide relative spread, thin/gappy, 10–100% moves, whole/half-dollar magnets, halt (LULD) risk, market orders slip** | **percent-based or wide-ATR stops; avoid sub-minute scalps; high slippage + commission in backtest; size down; RVOL/volume-spike filters; prefer limit orders; gap handling** |
| Futures | ES, NQ, CL | tick value via `syminfo.pointvalue`, ~23h, RTH vs ETH | point/tick stops; per-contract commission; session-aware |
| Crypto | BTC, ETH | 24/7, no sessions, high vol | percent stops; no session gating; higher slippage |
| Forex | EURUSD | pips, session overlaps | pip stops; London/NY session logic |

**How the agent applies it (runtime):**
1. On any generate/fix/port request, it reads the target instrument first — `chart_get_state` + `symbol_info` + `quote_get` (symbol, `type`, exchange, current price) — or asks if no chart context.
2. It classifies the ticker and **selects defaults from `instrument-classes.md`**: stop/target basis, order type guidance, slippage/commission for `strategy()`, session handling, and guardrails (e.g., it will flag or refuse "5s scalp, zero slippage" on a thin penny and propose a realistic variant).
3. It writes **instrument-aware Pine** using built-ins so the script itself adapts where sensible: `syminfo.mintick` (tick rounding), `syminfo.type`, `syminfo.pointvalue`, `syminfo.currency`, `syminfo.session`, and price-level branches (e.g., percent stops when `close < $5`, ATR stops otherwise).
4. It states the class + assumptions in its hand-off so the user knows *why* those parameters were chosen.

## 5. Backtestable strategies with buy/sell orders

**Requirement:** produce `strategy()` scripts that run in TradingView's Strategy Tester with real orders — and, for Node ports, prove parity.

`strategy-backtest.md` covers:
- **Declaration realism:** `initial_capital`, `default_qty_type`/`default_qty_value`, `commission_type`/`commission_value`, `slippage`, `pyramiding`, `process_orders_on_close`, `calc_on_every_tick` — set per instrument class (§4).
- **Orders:** `strategy.entry` (long/short, `limit`/`stop`), `strategy.exit` (`stop`/`limit`/`trail_*`, bracket OCO), `strategy.close`, `strategy.cancel`; named IDs; `strategy.position_size`.
- **Anti-cheat:** `barmerge.lookahead_off`, no future-peeking `request.security`, repaint checks, realistic fill assumptions — enforced via the shared checklist.
- **Closing the loop for strategies:** after a clean compile, the agent reads the Strategy Tester output via the MCP — `data_get_strategy_results`, `data_get_trades`, `data_get_equity` — and reports net/PF/win-rate/trades and the trade list.
- **Node parity (Port mode):** generate the `strategy()` twin from `tools/research/lib/engine.mjs`, run the Node harness via Bash, and diff trade-by-trade signals against the Strategy Tester trades — the `pine-twin-writer` + `backtest-runner` discipline, but self-contained.

## 6. How it runs (the closed loop)

**Modes:** `generate` · `fix` · `port` · `review`. Shared loop:

1. **Understand** — parse the ask; identify instrument class (§4); ask a clarifying question only when genuinely ambiguous.
2. **Draft** — write Pine v6 grounded in the pack, with instrument-appropriate defaults.
3. **Inject** — `pine_new` (fresh, default) or `pine_open` (named existing) → `pine_set_source`.
4. **Compile** — `pine_smart_compile`; read `pine_get_errors` + `pine_get_console`.
5. **Self-fix loop** — diagnose against the pack, patch, re-inject, re-compile; **cap ≈6 iterations**, then surface anything unresolved honestly (never fake green).
6. **Self-review** — run `pine-correctness-checklist.md` (repaint / na / session / object limits / lookahead).
7. **Backtest (strategies)** — read Strategy-Tester results via MCP; parity-diff for ports.
8. **Hand off** — final script + short review + "how to add it" + backtest summary. **`pine_save` only on explicit OK.**

**MCP + tools it uses:**
- Pine: `pine_new`, `pine_open`, `pine_set_source`, `pine_smart_compile`, `pine_compile`, `pine_check`, `pine_analyze`, `pine_get_errors`, `pine_get_console`, `pine_get_source`, `pine_save`, `pine_list_scripts`
- Instrument context: `chart_get_state`, `symbol_info`, `quote_get`
- Backtest read-back: `data_get_strategy_results`, `data_get_trades`, `data_get_equity`
- Chart (optional): `chart_manage_indicator`, `capture_screenshot`
- Local: `Read`, `Glob`, `Grep`, `Edit`, `Write`, `Bash` (Node parity runs)

**Model:** Opus (code-generation + multi-step reasoning quality).

## 7. How it communicates

- **Invocation:** "pine-smith, build/fix/port/review …" → dispatched as the subagent. (Optional future: a `/pine` one-word wrapper — out of scope for v1.)
- **Conversational iteration:** the user refines ("tighter stop", "add a volume filter", "make it a strategy") and the agent re-runs the loop.
- **Structured hand-off** each turn: (1) the working, compiled Pine; (2) instrument class + why these params; (3) a short correctness review; (4) add-to-chart / backtest instructions; (5) for strategies, the Strategy-Tester metrics (and parity result for ports).
- **Honesty rule:** if it can't reach a clean compile within the cap, it says so and shows the remaining errors + its best diagnosis — it does not claim success.

## 8. Safety & guardrails

- Defaults to `pine_new` so it never clobbers a saved script; uses `pine_open` only against a named target.
- Never `pine_save` (persist) without explicit user OK.
- Does not change the chart's symbol, timeframe, or indicators beyond the Pine editor unless asked.
- Caps the fix loop; surfaces unresolved errors rather than faking a green compile.
- Flags instrument/timeframe mismatches (e.g., unrealistic scalp on a thin penny) instead of silently producing fantasy backtests.

## 9. Explicitly out of scope (YAGNI)

- Hugging Face fine-tunes / datasets (research: v5, tiny, low quality — not worth wiring in).
- Standalone chat app or MCP server (subagent form chosen).
- `/pine` slash-command wrapper (nice-to-have, later).
- Building features on `request.footprint()` accessors until their exact spellings are verified against the v6 manual (documented as "verify first").

## 10. Acceptance tests (drive the implementation plan)

1. **Generate:** from "opening-range breakout with retest confirmation," pine-smith produces a v6 script that compiles clean on the chart and passes the checklist.
2. **Fix:** given the Leviathan object-limit runtime crash, it raises the caps + bounds drawings and reaches a clean run on a 15s chart.
3. **Instrument awareness:** the same "VWAP mean-reversion" request yields materially different defaults for NVDA vs a sub-$5 mover (stop basis, slippage, timeframe guardrail) — verifiable in the generated code.
4. **Backtestable strategy:** it emits a `strategy()` with entry/exit orders that runs in the Strategy Tester, and reports results read back via `data_get_strategy_results`/`data_get_trades`.
5. **Port + parity:** it transcribes a `tools/research` engine to a Pine `strategy()` twin and diffs trades against the Node harness within tolerance.
