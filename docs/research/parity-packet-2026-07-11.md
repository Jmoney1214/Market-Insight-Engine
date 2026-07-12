# TV Strategy Tester parity packet — 2026-07-11 (Node half, FROZEN)

**Purpose:** Duty #1 of `docs/superpowers/specs/2026-07-11-tv-mcp-max-utilization.md`
— independent Strategy Tester cross-validation of the JUMPDAY engine. This
file freezes the Node engine's side so the local terminal (the only
environment with the TradingView MCP) can run the TV half as a mechanical
checklist. **No TradingView numbers appear here — the TV half is PENDING a
local pass.** Contract: `research/parity-audit.md`. Verdict tooling:
`tools/research/tv_parity_check.mjs` + `tools/research/lib/parity.mjs`.

## (a) Engine configuration of record

| Item | Value |
|---|---|
| Git SHA (engine + this run) | `8f4c25a` |
| Engine | `tools/research/lib/engine.mjs` `runEngine()` — rider (JUMPDAY_RIDER) + scalper (LARGECAP_SCALPER) |
| Replay set | The canonical 13-session journal set: every `journal_entries` row with `manual_outcome->>source = 'replay_rerun'` (38 rows, 13 distinct sessions, backfilled at engine shas `d76f59b`/`e7968fc`) |
| Sessions | 2025-07-21, 07-22, 07-23 · 2025-09-03 · 2026-04-14, 04-15, 04-16 · 2026-05-04, 05-05, 05-08 · 2026-07-02, 07-06, 07-08 |
| Bars | Alpaca **SIP** (`feed=sip`, `adjustment=split`), 5-minute, per-session window **04:00–20:00 ET**; daily bars (30 cal-days lookback) for prevClose |
| Fill model | Signal on bar close → fill **next bar open + slippage**; slippage = max($0.01, 0.03% of first RTH open); stop fills at `min(bar.open, stop) − slip`; EOD flatten 15:50 at `close − slip`; commission 2 bps/side |
| Fill mode | `stop_first` (canonical). **`tv_ohlc_path` produces bit-identical trades on this set** (no bar has stop+target both inside — rider has no target), so one TV run verifies both |
| Sizing | Fixed $25k, 1% risk, 50% notional cap, floor qty (research capital — differs from Pine's compounding `strategy.equity` **by design**; qty/absolute-$ excluded from parity verdicts) |
| Run date / freshness | 2026-07-12, fresh fetch + re-run at `8f4c25a`. **Exact reproduction of all 38 journal rows: ΔR = 0.00 and Δ$ = 0.00 on every trade** — no bar revisions since the backfill, no engine drift |
| Data crosscheck (Rule 6) | `crosscheck.mjs 2026-07-06..08, PENG/IREN/AVGO/AMD, --intraday PENG`: daily closes match FMP to ≤0.013%. 25 intraday open/close flags on PENG 5m bars (0.25–1.32%) were adjudicated against Alpaca's own 1-min SIP tape: **all 24 distinct bars internally consistent** (5m o/c == 1m tape) → FMP feed-construction difference on a fast small-cap, not a data defect. SIP remains the plane of record. |
| Tests at freeze | `tools/research/test/`: dates 5/5 · engine 4/4 · engine.rmultiple 2/2 · parity 15/15 · postflight 3/3 · tv_adapter 9/9 — **38/38 pass** at `8f4c25a` |

Node-side aggregates the TV run must land within tolerance of:

| Slice | Trades | WR | Net $ | Total R | PF |
|---|---|---|---|---|---|
| All 38 | 38 | 34.2% | −$2,377.42 | −12.22 | 0.53 |
| JUMPDAY_RIDER | 31 | 32.3% | −$1,785.25 | −8.86 | 0.59 |
| LARGECAP_SCALPER | 7 | 42.9% | −$592.17 | −3.36 | 0.22 |
| Exit mix | 23 stop / 15 eod | | | | |

(Total R −12.22 independently matches finding #26's ARM A baseline computed
from the journal rows — three-way agreement: journal == prior finding == this
fresh run.) Note for honesty: this replay set is the measured scoreboard set
and is **net negative**; it is not the Aug-2025–Jul-2026 tuning result and
this exercise verifies **engine correctness**, not edge.

## (b) Per-trade expected table (the numbers TV must match)

Bar times are **ET, bar-start of the FILL bar** (signal fired on the prior
bar's close). `Qty*`/`PnL*` are informational only — excluded from parity
verdicts (fixed $25k vs Pine compounding). Parity keys: **entry px, exit px,
side (all long), trade count per symbol-session, exit reason**.

| # | Session (ET) | Symbol | Class | Entry bar | Entry px | Exit bar | Exit px | Stop | Reason | Qty* | PnL* | R |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 2025-07-21 | GLXY | rider | 09:55 | 30.37 | 11:40 | 29.27 | 29.28 | stop | 234 | $-259.67 | -1.01 |
| 2 | 2025-07-21 | SBET | rider | 10:20 | 33.52 | 10:40 | 32.43 | 32.44 | stop | 229 | $-252.32 | -1.01 |
| 3 | 2025-07-22 | SBET | rider | 10:35 | 26.50 | 15:50 | 27.36 | 25.38 | eod | 225 | $192.09 | 0.77 |
| 4 | 2025-07-23 | SMR | rider | 10:00 | 48.00 | 10:05 | 47.38 | 47.40 | stop | 260 | $-166.46 | -1.02 |
| 5 | 2025-07-23 | ABVX | rider | 10:05 | 67.60 | 15:50 | 69.48 | 62.37 | eod | 49 | $90.88 | 0.36 |
| 6 | 2025-09-03 | BMNR | rider | 09:45 | 44.44 | 15:50 | 45.32 | 42.89 | eod | 162 | $138.66 | 0.56 |
| 7 | 2025-09-03 | SMR | rider | 10:15 | 41.28 | 14:40 | 40.74 | 40.75 | stop | 302 | $-169.22 | -1.02 |
| 8 | 2026-04-14 | CRWV | rider | 09:45 | 117.66 | 15:50 | 117.74 | 112.90 | eod | 52 | $1.25 | 0.01 |
| 9 | 2026-04-14 | IREN | rider | 09:45 | 45.63 | 15:50 | 47.09 | 44.14 | eod | 168 | $241.82 | 0.97 |
| 10 | 2026-04-14 | CRCL | rider | 09:45 | 105.45 | 15:50 | 105.06 | 101.31 | eod | 60 | $-25.71 | -0.09 |
| 11 | 2026-04-14 | OKLO | rider | 09:45 | 59.72 | 09:55 | 58.29 | 58.31 | stop | 169 | $-244.61 | -1.01 |
| 12 | 2026-04-15 | OKLO | rider | 09:45 | 63.76 | 15:50 | 63.01 | 60.60 | eod | 79 | $-61.06 | -0.24 |
| 13 | 2026-04-15 | AVGO | scalper | 09:50 | 394.82 | 15:50 | 395.77 | 385.55 | eod | 27 | $21.41 | 0.10 |
| 14 | 2026-04-15 | IONQ | rider | 10:25 | 41.16 | 15:50 | 43.07 | 39.91 | eod | 202 | $383.83 | 1.54 |
| 15 | 2026-04-16 | AEHR | rider | 09:45 | 86.71 | 10:50 | 82.60 | 82.63 | stop | 59 | $-244.73 | -1.01 |
| 16 | 2026-04-16 | RKLB | rider | 10:00 | 79.39 | 15:50 | 82.86 | 76.58 | eod | 89 | $305.84 | 1.23 |
| 17 | 2026-05-04 | MU | scalper | 10:45 | 585.97 | 12:15 | 574.23 | 574.39 | stop | 21 | $-251.46 | -1.01 |
| 18 | 2026-05-04 | SNDK | scalper | 10:45 | 1250.59 | 15:50 | 1259.13 | 1215.75 | eod | 7 | $56.28 | 0.25 |
| 19 | 2026-05-05 | AMD | scalper | 09:45 | 351.14 | 15:50 | 353.94 | 343.47 | eod | 32 | $85.21 | 0.37 |
| 20 | 2026-05-05 | DOCN | rider | 10:20 | 145.69 | 10:30 | 143.79 | 143.83 | stop | 85 | $-166.15 | -1.02 |
| 21 | 2026-05-05 | MU | scalper | 10:50 | 638.55 | 12:40 | 628.41 | 628.59 | stop | 19 | $-197.52 | -1.02 |
| 22 | 2026-05-08 | AXTI | rider | 10:10 | 123.30 | 10:15 | 119.98 | 120.01 | stop | 76 | $-256.06 | -1.01 |
| 23 | 2026-05-08 | RKLB | rider | 10:35 | 96.96 | 10:40 | 94.95 | 94.97 | stop | 127 | $-259.77 | -1.01 |
| 24 | 2026-07-02 | ABVX | rider | 09:50 | 141.04 | 15:50 | 143.67 | 138.52 | eod | 88 | $226.14 | 1.04 |
| 25 | 2026-07-02 | MSTR | rider | 10:10 | 102.53 | 10:25 | 100.59 | 100.62 | stop | 121 | $-239.42 | -1.02 |
| 26 | 2026-07-06 | WULF | rider | 09:45 | 24.72 | 09:50 | 24.23 | 24.24 | stop | 505 | $-253.77 | -1.02 |
| 27 | 2026-07-06 | AVGO | scalper | 09:50 | 380.11 | 10:55 | 374.85 | 374.96 | stop | 32 | $-173.30 | -1.02 |
| 28 | 2026-07-06 | HUT | rider | 10:05 | 107.78 | 11:35 | 105.71 | 105.74 | stop | 115 | $-243.54 | -1.02 |
| 29 | 2026-07-06 | RIOT | rider | 10:05 | 23.86 | 11:35 | 23.42 | 23.43 | stop | 523 | $-232.89 | -1.02 |
| 30 | 2026-07-06 | AMKR | rider | 10:10 | 73.06 | 10:40 | 71.89 | 71.92 | stop | 171 | $-204.69 | -1.02 |
| 31 | 2026-07-06 | APLD | rider | 10:10 | 35.07 | 10:55 | 34.56 | 34.57 | stop | 356 | $-187.06 | -1.02 |
| 32 | 2026-07-06 | IREN | rider | 10:20 | 43.72 | 15:50 | 43.90 | 43.21 | eod | 285 | $44.85 | 0.34 |
| 33 | 2026-07-06 | CIFR | rider | 10:25 | 22.07 | 13:35 | 21.64 | 21.65 | stop | 566 | $-249.21 | -1.02 |
| 34 | 2026-07-06 | SHAZ | rider | 10:40 | 80.74 | 11:15 | 79.71 | 79.73 | stop | 154 | $-162.65 | -1.02 |
| 35 | 2026-07-06 | AXTI | rider | 10:45 | 66.78 | 10:50 | 65.64 | 65.66 | stop | 187 | $-219.23 | -1.01 |
| 36 | 2026-07-06 | PENG | rider | 10:45 | 69.85 | 12:50 | 68.46 | 68.48 | stop | 168 | $-237.88 | -1.01 |
| 37 | 2026-07-06 | AMD | scalper | 10:55 | 567.36 | 11:15 | 561.55 | 561.71 | stop | 22 | $-132.79 | -1.03 |
| 38 | 2026-07-08 | PENG | rider | 10:30 | 72.94 | 15:50 | 78.58 | 71.52 | eod | 165 | $925.49 | 3.96 |

Every (symbol, session) pair above produced exactly **one** trade. A second
TV trade on any pair, or a TV trade on a pair-day the table omits, is a
`SIGNAL_MISMATCH`.

## (c) Exact TradingView setup (local half)

- **Scripts:** `tools/pine/morning_scan_jumpday_long.pine` for `rider` rows;
  `tools/pine/morning_scan_largecap_scalper.pine` for `scalper` rows. Compile
  via `pine_set_source` + `pine_smart_compile`; leave every input at default
  (defaults == tested config == engine constants).
- **Chart:** 5-minute. **Extended Trading Hours ON — CRITICAL.** The engine
  consumes 04:00–20:00 ET bars: the $2M pre-market dollar gate and the session
  VWAP/EMA warm-up need pre-market bars. An RTH-only chart will gate out every
  day (pmDollar stays 0) and its VWAP/EMA differ.
- **Data:** split-adjusted (TV default), regular consolidated feed. Engine
  side is Alpaca SIP — small print-level differences are `FILL_DIFF`, never
  drift (parity-audit § Data feed).
- **Strategy properties** (already in the `strategy()` headers — verify, don't
  re-enter): initial capital $25,000; commission `percent 0.02` (= 2 bps/side);
  slippage `2` ticks; `calc_on_every_tick = false`; fills on next bar open
  (TV default, mirrors the engine's next-bar-open + slip model; engine slip is
  0.03% of open, ≈ 2–4 ticks on these prices — inside tolerance).
- **Order size:** none — the script sizes itself (1% risk / 50% notional of
  `strategy.equity`, compounding). Qty and absolute $ will NOT match the fixed
  $25k engine sizing; that is by design and excluded from the verdict.
- **Date range:** run each row as a **single-session window** (chart scrolled
  /replayed to that date; `--from = --to =` the session date on the Node side).
  Two reasons this is mandatory, not convenience:
  1. `data_get_trades` caps at ~20 orders (~10 trades); multi-day dumps
     truncate and hard-fail the completeness guard.
  2. `tv_parity_check.mjs` runs `runEngine` **without the scan-day gates**
     (mtd/pm$/badge are in `scanDay`), while the Pine applies its own
     mtd/pm-dollar gates on-chart. On the journal sessions both sides
     qualified by construction; on other days they can legitimately disagree.
     Single-session windows keep the comparison on qualified ground.
- **Daily history:** the Pine mtd gate reads 10 completed daily sessions via
  `request.security("1D", …)` — make sure the chart has ≥ 30 daily bars of
  history loaded before the session under test.
- **Known intentional gaps** (parity-audit § intentional differences): EMA
  warm-up (engine seeds from that day's 04:00 pre-market; Pine carries prior
  chart history) and sizing base. Both classified, neither is drift.

## (d) Agreement criterion (what pass/fail means)

Verdict logic is frozen in `tools/research/lib/parity.mjs` and applied by
`tv_parity_check.mjs` — do not eyeball:

- **Per-trade:** entry/exit price within `max($0.05, 0.2% of price)`
  (`FILL_DIFF` inside, `EXIT_DIFF`/hard-fail beyond); side must match; trade
  count per window must match; exit reason compared (TV STOP→stop,
  close_all→close≈eod).
- **Aggregate:** TV gross vs Node gross within **~1–2%** (fill-model noise;
  TV net additionally carries commission — reported, not failed).
- **Excluded by design:** qty, absolute $ PnL (compounding vs fixed $25k).
- **Violation** (hard-fail or drift, exit code 1) = a **bug finding in one of
  the two engines**. It blocks citing the JUMPDAY numbers — including the
  scoreboard set above — until the discrepancy is root-caused and resolved.
  Agreement = the Rule-6 caveat ("engine never independently verified
  end-to-end") is retired for this engine version.

## (e) One-command instruction per row (local terminal)

For each (symbol, session) row — start with the priority subset below:

1. In the TV-MCP session: `chart_set_symbol <SYM>` · `chart_set_timeframe 5` ·
   ETH ON · load/compile the class's Pine script · navigate/replay to the
   session date · `data_get_trades` + `data_get_strategy_results` → save as
   one JSON `{ "strategy_results": {...}, "trades": [...] }` →
   `tools/research/scratch/tv_<SYM>_<DATE>.json`.
2. Then ONE command (creds in env):

```sh
node tools/research/tv_parity_check.mjs \
  --trades tools/research/scratch/tv_<SYM>_<DATE>.json \
  --symbol <SYM> --from <DATE> --to <DATE> \
  --class <rider|scalper> --fill tv_ohlc_path
```

Exit 0 = parity for that row. Exit 1 = drift/hard-fail — capture the printed
mismatch lines verbatim into the finding.

**Priority subset (minimum viable verification, 8 rows):** #38 PENG 07-08
(largest winner, +3.96R, eod), #36 PENG 07-06 (same symbol, stop — pairs with
#38), #14 IONQ 04-15 (eod winner), #11 OKLO 04-14 (fast 2-bar stop), #3 SBET
07-22 (2025 EDT session, eod), #17 MU 05-04 (scalper stop, high price), #13
AVGO 04-15 (scalper eod), #26 WULF 07-06 (1-bar stop, gap-through risk).
Full 38-row pass = authoritative; consider the CSV path
(`parity_check.mjs --csv`) for multi-day symbols if per-day dumps are tedious.

## Status

- [x] Node half: fresh run at `8f4c25a`, 38/38 journal reproduction, tests
      38/38, data crosscheck explained — FROZEN (this file).
- [ ] TV half: PENDING local pass. No TV numbers exist yet; nothing in this
      packet is "verified" until `tv_parity_check.mjs` exits 0 on real
      `data_get_trades` dumps.
