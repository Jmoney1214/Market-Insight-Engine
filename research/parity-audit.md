# Pine ↔ Node parity contract

The strategy rules live twice: in the TradingView Pine scripts (`tools/pine/`)
and in the Node harness engines (`tools/research/lib/engine.mjs`). This file is
the committed parity contract; the static audit below was produced by the
`pine-reviewer` agent and its four divergences were fixed in PR #14
(merged `c9b8486`). The empirical regression guard is
`tools/research/parity_check.mjs` (diffs a TradingView Strategy Tester CSV
export against the harness on the same symbol/days; exit code 1 on drift).

**Any rule change on either side must update the other side AND this table.**

| Rule | Pine | Harness | Status |
|---|---|---|---|
| Multi-trade day filter (mtd ≥ 7/10 ranging ≥2%) | rider:80, scalper:80 | `engine.mjs` scanDay gate `mtd_min7` | MATCH (fixed in #14) |
| Pre-market conviction ≥ $2M **dollars** | rider:40/82, scalper:41/80 | scanDay gate `pm_dollar_2m` | MATCH (rider migrated shares→dollars in #14) |
| Price ceiling $150 — rider only (scalper exempt by design) | rider:80 live re-check; scalper none | scanDay `price_ceiling` per class + rider live `ceilOk` | MATCH (fixed in #14) |
| Gap locked at open, ±1.5% thresholds | rider/scalper:74-81 | `runEngine` gap vs prevClose | MATCH |
| Entry window 09:40–11:00, session-end exclusive | `"0940-1100"` | `b.hm >= "09:40" && b.hm < "11:00"` | MATCH (fixed in #14) |
| Entry trigger: low≤EMA9, close>EMA9, close>VWAP, EMA9>EMA20 | rider/scalper:89-90 | identical condition | MATCH |
| Stop: min(low, low[1]) − 0.8%·close, absolute level | :100 | identical | MATCH |
| R-distance & sizing from SIGNAL bar | scalper:100-112 | `pending.dist` carried from signal bar | MATCH (fixed in #14) |
| Rider exit: ride to 15:50 flatten (no target) | rider:113-119 | `tgt = Infinity`, eod at 15:50 | MATCH |
| Scalper exit: 1.5R target | scalper:51,111 | `rr: 1.5` | MATCH |
| Sizing 1% risk, 50% notional cap | :102-105 | identical (fixed $25k, no compounding — intentional) | MATCH* |
| Daily loss brake $500 | :82-83 | `dayPnl > -500` | MATCH |
| Max trades: rider 1 / scalper 3 | :51 | cfg per class | MATCH |

## Intentional, quantified differences (not drift)

- **Fill model**: harness default `stop_first` (pessimistic) vs TradingView's
  OHLC-path emulator. Harness offers `--fill tv_ohlc_path` for parity runs and
  `target_first` as the optimistic bound.
- **Data feed**: Alpaca SIP vs TradingView chart feed — bar edges can differ;
  classified as `FILL_DIFF` by the parity checker, never as drift.
- **Sizing base**: fixed $25k research capital vs Pine's compounding
  `strategy.equity` — quantity comparisons are excluded from parity verdicts.
- **EMA warm-up**: harness seeds EMAs from the 04:00 pre-market; Pine uses
  prior chart history. Immaterial with an active pre-market; the $2M pm-dollar
  gate excludes the thin-pre-market days where it could matter.
