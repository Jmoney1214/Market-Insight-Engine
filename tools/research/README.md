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
| `parity_check.mjs` | Pine↔Node regression guard: diffs a TradingView Strategy Tester CSV export against the harness (`research/parity-audit.md` is the contract) |
| `class_backtest.mjs` | Legacy per-symbol engine sweeps (kept for multi-month single-symbol studies) |

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
