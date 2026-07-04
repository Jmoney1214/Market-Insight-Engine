# Intraday strategy templates (Pine Script v5)

TradingView strategy templates that operationalize the conclusions in
[`docs/backtest-findings.md`](../../docs/backtest-findings.md): single lagging
triggers aren't standalone alpha, so these lean on **regime filtering + strict
risk control** instead. They are educational templates to validate in
TradingView's Strategy Tester — **not financial advice, and not proven
profitable.**

## The three strategies

| File | Temperament | Core logic |
|------|-------------|-----------|
| `intraday_trend_pullback.pine` | Trend-following | Long pullbacks (RSI reclaims 45) **with** a higher-timeframe uptrend + VWAP bias |
| `opening_range_breakout.pine` | Momentum | Break of the first 15-min range, filtered by HTF trend |
| `rsi_divergence.pine` | Mean-reversion | Pivot-based regular RSI divergence (counter-trend reversals) |
| `morning_scan_overlay.pine` | **Indicator** (not a strategy) | Recreates a FinDesk Morning Scan row on the chart: gap vs prior close, pre-market volume, ≥2% multi-trade count, ATR/RSI, ex-catalyst score, list eligibility. Use on 1–15m with Extended Hours ON |

Run all three on the same symbol/timeframe to compare a trend engine, a
momentum engine, and a mean-reversion engine head-to-head.

## Shared design principles

- **Risk-based sizing** — every entry risks a fixed % of equity (`riskPct`)
  divided by the ATR stop distance, so position size adapts to volatility.
- **Defined exits** — ATR stop + reward:risk target on every trade.
- **No overnight risk** — positions are force-flattened in the close window.
- **Costs modeled** — 2 bps/side commission + 2-tick slippage by default.
- **Daily guardrails** — `maxTrades` per day caps overtrading.

## Step-by-step: run one in TradingView

1. Open [tradingview.com](https://www.tradingview.com) → any chart.
2. Set the chart to an **intraday timeframe** (5-min is a sensible default) and a
   **liquid symbol** (e.g. `AAPL`, `SPY`, `ES1!`).
3. Bottom panel → **Pine Editor** → **Open** ▸ *New blank indicator*.
4. Delete the boilerplate, paste the full contents of one `.pine` file.
5. Click **Save** (name it), then **Add to chart**. Because the script starts
   with `strategy(...)`, it attaches as a strategy, not an indicator.
6. Open the **Strategy Tester** tab (next to Pine Editor) for the equity curve,
   net profit, max drawdown, profit factor, and trade list.
7. Click the strategy's **⚙ Settings** to tune inputs (session, ATR multiples,
   RR, risk %, HTF). Re-read the tester after each change.

## Step-by-step: compare the three fairly

1. Add all three to the **same chart, same symbol, same timeframe**.
2. Give each the **same** `initial_capital`, `riskPct`, commission, and slippage
   so the tester numbers are comparable.
3. Compare on **risk-adjusted** terms, not just net profit: **max drawdown**,
   **profit factor**, **% profitable**, and **avg trade** — a strategy that nets
   more with 3× the drawdown is not better.
4. Note **exposure / # trades**: a strategy that barely trades can look great by
   luck. More trades = more statistically meaningful.

## Validate before trusting (important)

- **Walk-forward**, don't curve-fit: tune inputs on an older date range, then
  test *untouched* on a newer range. If it only works on the range you tuned,
  it's overfit — exactly the failure mode `docs/backtest-findings.md` guards
  against.
- **Repaint check** (trend-pullback / ORB): the HTF EMA uses
  `lookahead=barmerge.lookahead_off`, but any `request.security` value can still
  update intrabar until the HTF bar closes in real time. For zero-repaint live
  use, change `ta.ema(close, htfLen)` to `ta.ema(close, htfLen)[1]` (adds one
  HTF bar of lag).
- **Divergence lag**: `rsi_divergence.pine` confirms a pivot `pivR` bars after
  it forms — that delay is inherent to pivot detection, not a bug.
- Paper-trade before any live capital. Intraday edges are thin and
  cost-sensitive; the tester tells the truth.
