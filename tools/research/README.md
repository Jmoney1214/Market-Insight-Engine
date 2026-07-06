# Research harness (offline backtesting)

Wall-Street-grade PIT backtester: 8:30 ET scanner replay with **gate
telemetry** → badge-matched engines → **post-flight attribution** (movers,
deterministic reason codes, catch rates) → **stamped reports**. Working tools
of the `backtest-runner` and `replay-grader` subagents (`.claude/agents/`).

## Data-plane contract (HARD RULE)

- **Alpaca SIP is the only source of bars** — daily and intraday, `feed=sip`,
  `adjustment=split`. All replay/backtest/postflight bars come from it.
- **FMP is screener / earnings-calendar / enrichment only. Never bars.**
- Credentials from env only: `ALPACA_API_KEY_ID`, `ALPACA_API_SECRET_KEY`,
  `FMP_API_KEY`. Never commit keys.

## Run

```sh
node pipeline.mjs --from 2026-07-02 [--to 2026-07-03] [--report] [--html] \
  [--fill stop_first|target_first|tv_ohlc_path]
```

- Dates are CLI args — never edit source for a run. Weekends auto-skip;
  holidays report as "no session". Session math is DST-correct per date.
- `--report` writes `research/reports/<from>_<to>.md` (`--html` adds a
  standalone page), stamped with git SHA, provider, feed, timezone, session
  template, date range, fill mode, and config hash.
- Full results (per-day boards, trades, attribution) go to
  `pipeline_results.json` (gitignored).

## Modules

| File | What it does |
|---|---|
| `lib/dates.mjs` | CLI parsing, trading days, per-date EST/EDT session windows |
| `lib/data.mjs` | Alpaca/FMP fetchers, cache (TTL), hard-fail on partial fetches, metadata stamping |
| `lib/engine.mjs` | Scanner with per-symbol **gate telemetry** + badge-matched engines (rider/scalper) with fill modes |
| `lib/postflight.mjs` | Realized outcomes, ≥5% movers, reason codes **from logged gates**, catch rates |
| `lib/report.mjs` | Markdown/HTML report writer |
| `parity_check.mjs` | Pine↔Node regression guard (CSV path): diffs a TradingView Strategy Tester CSV export against the harness, TIME-matched (`research/parity-audit.md` is the contract) |
| `tv_parity_check.mjs` | Pine↔Node regression guard (MCP path): diffs a TradingView-MCP `data_get_trades` dump against the harness, SEQUENCE-matched — no manual CSV export |
| `lib/parity.mjs` | Shared verdict core for both paths: `matchByTime`, `matchBySequence`, `tally`, `hardFail` |
| `lib/tradingview_mcp_adapter.mjs` | Normalizes a `data_get_trades` payload (orders → round-trip trades) |
| `crosscheck.mjs` | Cross-source data verifier: Alpaca SIP vs FMP for a date range (daily close/volume + optional intraday 5m OHLC), exit 1 on unexplained drift |
| `class_backtest.mjs` | Legacy per-symbol engine sweeps (kept for multi-month single-symbol studies) |

## Cross-source verification (multi-check rule)

Every backtest over a NEW date range gets its data independently verified
before results are trusted:

```sh
node crosscheck.mjs --from 2025-07-21 --to 2025-07-25 \
  [--symbols HIMS,COIN] [--sample 10] [--intraday HIMS]
```

- Compares Alpaca SIP (the engine's only bar source) against FMP EOD daily
  close/volume, plus intraday 5m OHLC for `--intraday` symbols. Both sides
  fetch LIVE — the verifier never reads the harness cache.
- Disputed 5m highs/lows are adjudicated against Alpaca's own 1-minute SIP
  tape: a confirmed SIP extreme that FMP's coarser feed missed is a note, not
  a failure. FMP showing a *wider* range than SIP is a real issue.
- Exit 1 = unexplained drift → do not trust backtests over that range until
  each issue is explained. FMP stays a verifier here — never a bar source
  (data-plane contract unchanged).

## Pine↔Node parity (two paths, one verdict core)

Both paths prove the harness engine (`runEngine`) reproduces the TradingView
Pine strategy. They share `lib/parity.mjs`; only how TradingView trades arrive
differs.

**MCP path (automated, no manual export) — for fast spot-checks:**

```sh
# 1. Drive TradingView via the MCP (in a Claude session):
#    chart_set_symbol HIMS · chart_set_timeframe 5 · (ensure the rider/scalper
#    Pine strategy is on the chart: pine_set_source + pine_smart_compile) ·
#    data_get_trades + data_get_strategy_results → save both into one JSON:
#    { "strategy_results": {...}, "trades": [ ...orders... ] }  →  hims.tvdump.json
# 2. Diff it against the engine over the SAME date range:
node tv_parity_check.mjs --trades hims.tvdump.json --symbol HIMS \
  --from 2025-08-01 --to 2026-07-06 --class rider [--fill tv_ohlc_path]
```

- Matched by **chronological sequence** (the MCP payload carries no timestamps —
  only an order-sequence `time_index`). Verdict keys off entry/exit **price**,
  **side**, trade **count**, and exit reason.
- **qty and absolute P&L are reported but NOT hard-failed** — Node uses fixed
  $25k, TradingView compounds equity, so they differ by design
  (`research/parity-audit.md` § Sizing base).
- **Completeness guard:** `data_get_trades` caps at ~20 orders (~10 trades) per
  call. If the dump has fewer trades than `strategy_results.total_trades`, the
  run WARNS and hard-fails ("incomplete TV capture") rather than comparing a
  truncated tail. For a strategy with >10 trades, either bound the chart's
  loaded history or use the CSV path below for the full run.

**CSV path (full run, timestamped) — for complete regression:**

```sh
node parity_check.mjs --csv <TradingView Strategy Tester export.csv> \
  --symbol HIMS --class rider [--fill tv_ohlc_path]
```

- Matched by **wall-clock time** (±5 min entry / ±10 min exit). No order cap,
  carries dates — use this for the authoritative full-history parity.

Both exit 1 on drift (`SIGNAL_MISMATCH` + `EXIT_DIFF`) or hard-fail, 0 on clean
parity. `FILL_DIFF` (price within the fill-model/feed tolerance) is not drift.

## Reason codes (attribution)

`NOT_IN_UNIVERSE · GATED_HISTORY · GATED_PRICE_CAP · INVISIBLE_AT_0830 ·
RANK_CUT · BADGE_CUT · GATED_MTD · GATED_PMVOL · TOP5_CUT · DECLINED ·
NO_TRIGGER · TRADED` — each derived from the scanner's logged gate decisions
(pass/fail + the metric value that decided it), never inferred after the fact.

## Tests

```sh
node --test test/*.test.mjs
```

Covers DST/session math (January AND July), gate telemetry, reason-code
cascade, fill-mode intrabar resolution, and outcome math. Run before every PR.

## House rules

Point-in-time discipline; pessimistic fills by default (`stop_first`);
train/validate splits; never optimize a losing structure; state the baseline
to beat. Run configs are CLI args — nothing to restore after a run. Validated
class boundaries and standing findings: `research/findings.md`. Parity
contract: `research/parity-audit.md`. If you change an engine rule, update the
Pine twin, the parity contract, and run `parity_check.mjs`.
