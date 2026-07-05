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
before use. (Shipped code thresholds: rider ≥6.5%/day & ≥$20; scalper
≥$8B/day dollar volume — the "~$10B" phrasing elsewhere in this doc is the
class description, $8e9 is the deliberate code boundary.)

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

## Case study 3 (ACCEPTED with class limits): stock-class discovery

Question: does one script fit all tickers, or do "classes" of stocks need
different execution? Method: measured price / avg daily range / dollar volume
for 22 candidates (last 60 sessions), split into classes, trained engines on
2 symbols per class, validated the frozen winner on the untouched rest
(Aug 2025 – Jul 2026, 5m, costs modeled).

### Measured features first: price is NOT the class boundary

F ($13, 3.75%/day) behaves nothing like MARA ($12, 7.6%/day); QBTS ($22)
ranges more than PLUG ($2.64). The axes that matter are **average daily
range** and **dollar liquidity**. Methodological note: pre-market volume
filters must be in **dollars** (100k shares of PLUG ≈ $264k of nothing;
2M-dollar floor self-scales across classes).

### Results by class

| Class | Members tested | Train result | Frozen validation | Verdict |
|---|---|---|---|---|
| **Cheap movers** (<$20, ≥4%/day: PLUG, BBAI, NIO, MARA, SOFI) | rider/ORB/scalper all tried | best config barely +$212 (PLUG PF 0.24–0.57 everywhere) | −$1,280 (BBAI PF 0.57) | **REJECTED — no mechanical long edge. Gap-and-fade tape; do not trade these mechanically.** |
| **Hyper-volatile movers** (≥~7%/day, any price: HIMS, QBTS, IONQ, MARA) | rider PF 1.5–2.3 | IONQ unseen: **+$2,413 (PF 1.53)**; 3-symbol rider total +$8.6k | **ACCEPTED — ride, don't target** → `morning_scan_jumpday_long.pine` |
| **Mid movers** (4.5–6.5%/day: CVNA, AFRM, PLTR, DKNG, RBLX, HOOD, MSTR, RIOT) | (validated as part of B) | mixed: HOOD +$1,026 but CVNA −$1,976, AFRM −$2,080, PLTR −$1,124 | **UNRELIABLE — the rider's edge decays as daily range drops below ~6–7%. Trade only the hottest names.** |
| **Liquid large caps** (≥~$10B/day dollar vol: COIN, TSLA, NVDA, AMD, META) | scalper (3 trades, 1.5R targets) beat rider on COIN+TSLA (+$2.9k) | **positive on all 3 unseen: AMD +$1,364 (PF 1.47), META +$436 (PF 2.17), NVDA +$17** | **ACCEPTED — take profits, don't ride** → `morning_scan_largecap_scalper.pine` |

### The class law (measured, not assumed)

- **The gap-day filter is universal** (every accepted engine trades only
  gap-up mornings on active names) — but the **exit engine flips by class**:
  hyper-volatile movers pay you for *riding* (targets cut the winners that
  fund the system); liquid large caps pay you for *taking 1.5R* (they mean-
  revert intraday; riders give gains back).
- Volatility, not price, defines the class. A $12 name and a $130 name with
  8%/day tape belong to the same class; two $13 names (F vs MARA) do not.
- Cheap sub-$5–20 pumpers reward nobody mechanically long — the morning gap
  sells off. If they're ever traded, it's the dashboard's *fall* list logic,
  not a long script.
- Caveat: the ≥~7% vs 4.5–6.5% mover boundary was observed in validation
  data (winners/losers separate cleanly by range) but hasn't itself been
  re-validated out-of-sample; treat ~6–7%/day as a soft threshold and prefer
  the top of the scan's volatility ranking.

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
