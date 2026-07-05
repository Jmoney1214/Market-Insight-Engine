# Research findings — execution-layer case studies

Live grading of strategy ideas against real data. Companion to
[`docs/backtest-findings.md`](../docs/backtest-findings.md) (indicator-trigger
sweeps). Rule: **nothing ships on intuition; every rule proposal gets a
measured verdict.** All tests below use Alpaca SIP bars, split-adjusted,
costs modeled (2 bps/side commission + $0.02 slippage), signals on bar close,
fills at next bar open, stop-before-target intrabar (pessimistic — see
"Engine parity" at the bottom).

---

## Case study 1 (REJECTED): Morning Scan ORB strategy v1 on HIMS

`tools/pine/morning_scan_strategy.pine` run through TradingView's Strategy
Tester on HIMS 5m, Aug 4 2025 → Jun 18 2026 (user export, 293 trades).
Verified from the raw CSV — every number below recomputed, not quoted.

| Metric | Value |
|---|---|
| Net PnL | **−$7,000** on $25k (−28%) |
| Win rate / profit factor | 26.6% / **0.80** |
| Max drawdown | −$7,620 |
| Margin-call exits | 60 of 293 (sizing cap too aggressive) |
| Long side | 109 trades, −$4,839 (−$44.40/trade) |
| Short side | 184 trades, −$2,161 (−$11.75/trade) |

### The confirmed failure signature: death in the first bars

| Duration | Trades | Net PnL | Win rate |
|---|---|---|---|
| 0 bars | 78 | −$5,201 | 6.4% |
| 1–3 bars | 79 | −$10,041 | 13.9% |
| 4–12 bars | 60 | +$586 | 35.0% |
| **13+ bars** | **76** | **+$7,656** | **53.9%** |

Trades that died inside 15 minutes destroyed the account; trades that
survived an hour were genuinely profitable. The entry trigger was firing on
opening-session chop with no confirmation — **entry quality, not exit
geometry, was the failure** (median loss −$210 vs median win +$392; the
payoff shape was fine).

### The exit-hour fallacy (external analysis claim OVERTURNED)

An external review of this CSV claimed the strategy "improves after 12 PM"
and recommended blocking 9:50–11:15 and trading later. The CSV's hourly
buckets are by **exit** time. Every one of the 293 entries occurred between
**09:50 and 11:30** — there are no afternoon entries in the data. The
"profitable 12 PM–3 PM trades" are morning entries that survived into the
afternoon: the same fact as the 13+-bar row, restated. The data contains
zero evidence about afternoon *entries*; as written, "block 9:50–11:15"
would have blocked 100% of trades.

We tested the claim properly (simulator, actual afternoon entries — see
case study 2, experiments A/E): afternoon entries **lose** in both engines.

---

## Case study 2 (REJECTED): long-only high-frequency pullback scalper

Target spec: 10+ trades/day, long only, $500/day. Engine: buy every 9-EMA
pullback-reclaim above session VWAP on scan-qualified days, structural stop
below pullback low, up to 15 trades/day. HIMS 5m, Aug 2025 → Jul 2026.

**All 19 swept configurations lost money** (stop buffer 0.1–0.8%, RR 1–2.5,
time-outs 30 min/none): net −$4,452 to −$9,352, PF 0.66–0.80. Monotone
pattern: more trades/day → bigger losses. At this frequency, costs alone
drain ~$100–200/day from a $25k account. The 10-winning-trades/day goal is
not a tuning problem; the strategy class has negative edge on this data.

### Rule proposals from the external analysis, tested

| Experiment (HIMS, same period) | Net | PF | Verdict |
|---|---|---|---|
| Baseline scalper, all scan days, 09:40–15:00 | −$7,175 | 0.73 | baseline |
| A. Afternoon entries only (12:00–15:00) | −$3,069 | 0.79 | loses less, still loses |
| B. Cooldown 12 bars after stop-out | −$4,558 | 0.81 | loses less, still loses |
| C. Entries ≥11:15 + cooldown (their full prescription) | −$1,896 | 0.88 | best patch, **still negative** |
| D. Jump-day filter + morning window + ride (v2) + cooldown | **+$3,931** | **2.20** | cooldown moot at 1 trade/day |
| E. Jump-day filter but **afternoon** entries | −$1,195 | 0.67 | kills the v2 edge |

Verdict on the proposed gates (cooldown, window blocks, confirmation): they
are **loss reducers, not edge creators**. Sign only flips with day
selection. And experiment E is decisive against "trade later": on the very
days that are profitable, moving entries to the afternoon turns +$3.9k into
−$1.2k. **The edge is morning entries on the right days — not afternoon
entries, and not better patches on the wrong days.**

---

## What survived (ACCEPTED): two-step scanner → execution, jump days only

The external analysis's core architectural point — *scanner qualification is
not an entry trigger* — is correct and is what v2 implements
(`tools/pine/morning_scan_jumpday_long.pine`):

1. **Scanner qualifies the day** (watchlist, not signal): multi-trade
   profile ≥7/10, pre-market volume ≥100k, price ≤$150, **gap up ≥1.5%**
   locked at the open. Long only.
2. **Execution confirms the trade**: first 9-EMA pullback-reclaim with
   close > VWAP and EMA9 > EMA20, 09:40–11:00, one entry/day, structural
   stop below the pullback low (0.8% buffer), no target — ride to the 15:50
   flatten. $500 daily loss limit.

Frozen-config holdout across 7 symbols (Aug 2025 – Jul 2026):
HIMS +$3,931 (PF 2.2) · QBTS +$1,820 (1.45) · PLTR +$631 (1.63) ·
OKTA +$509 (2 days) · SOFI −$682 · MARA −$654 · RIOT −$509 →
**aggregate +$5,046 on $25k.** Edge concentrates in volatile, higher-priced
gappers; cheap high-float names are net negative — validate per symbol
before use.

### Standing rules distilled

- Day selection (which days to trade at all) is where the sign flips;
  entry-gate patches only shrink losses.
- Winners need hours, not minutes: no profit targets on riders, hard EOD
  flatten, and losers must be structurally stopped (below the pullback low),
  not indicator-stopped (multiples of 5-minute ATR are noise on 8%/day
  movers).
- Costs are a first-class term: any design >3 trades/day/symbol must beat
  its own commission+slippage drag before it can be net positive.
- Do not optimize parameters on a losing structure; change the structure.

---

## Engine parity note

This repo's simulator resolves intrabar stop-vs-target **stop-first**
(pessimistic). TradingView's broker emulator instead assumes an OHLC path
(open → nearer extreme → farther extreme → close), which sometimes awards
the target first. Consequence: our simulated results are biased *against*
strategies — the v2 numbers above cleared a harsher fill model than
TradingView applies, so TradingView Strategy Tester results should come in
equal or slightly better, never structurally worse. Any OHLC-path parity
work belongs to the separate offline quant-research engine, not this repo;
do not conflate engine parity with the v1 strategy failure, which is an
entry-quality problem confirmed by TradingView's own export.
