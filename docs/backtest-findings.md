# Trigger evaluation — backtest findings

An honest evaluation of the technical "triggers" the app computes (golden/death
cross, RSI overbought/oversold) against real historical Alpaca **SIP** data.
Run as throwaway harnesses reusing the app's shipped `sma()` / `rsi()` functions
(`artifacts/api-server/src/lib/providers/indicators.ts`); no strategy code ships
in the product.

> **Not investment advice.** These are descriptive indicators, not buy/sell
> signals. Results are in-sample, single-window, and simplified.

## Method

- **Universe:** 40 tickers fixed *a priori* across every sector, deliberately
  including laggards (INTC, PYPL, WBA, DIS, T, VZ, BA, PFE, F …) — not selected
  on outcome.
- **Window:** daily bars 2016 → 2026, spanning the 2018-Q4 selloff, 2020 COVID
  crash, and 2022 bear market.
- **Realism:** 10 bps/side transaction cost, positions act next-day (no
  look-ahead), long/flat only.
- **Metrics:** CAGR, annualized Sharpe, max drawdown, exposure, win rate,
  profit factor; benchmarked vs buy & hold.

## Results

### 1. Fidelity
Rolling indicators matched the shipped `rsi()` on **40/40** names — the
backtest tests the real production logic.

### 2. Performance (40 names, 2016→2026, 10 bps/side)

| Strategy   | CAGR  | Sharpe | Max DD | Exposure | Win rate |
|------------|-------|--------|--------|----------|----------|
| Buy & hold | 12.3% | 0.49   | −56.8% | 100%     | —        |
| MA cross   | 8.0%  | 0.35   | −45.7% | 58%      | 51%      |
| RSI 30/70  | 5.0%  | 0.33   | −47.7% | 40%      | 74%      |

Neither trigger beats buy & hold on return **or** risk-adjusted return, and each
beats it on only ~1 in 4 names. A high win rate (RSI 74%) coexists with poor
CAGR — small wins, occasional large losses, and low market exposure. Their one
real merit is **drawdown reduction** (~−46/−48% vs −57%) from sitting out
downtrends: useful as a risk overlay, not as alpha.

> An earlier, deliberately-biased pass (6 mega-cap winners, bull-only window,
> no costs) showed RSI at 88% win / +10.8% per trade. That was selection +
> regime illusion; the controlled test above is the real picture.

### 3. Parameter robustness

Swept MA fast/slow and RSI period/bands on the same setup. Both surfaces are
smooth — the defaults sit on gentle plateaus, not isolated spikes.

- **MA cross:** grid Sharpe 0.28–0.38 (mean 0.32 ± 0.03); default **50/200 =
  0.35**, rank 4/19. Mild drift toward longer averages, within noise.
- **RSI:** grid Sharpe 0.12–0.33 (mean 0.30 ± 0.05); default **14 @ 30/70 =
  0.33**, rank 3/16. The 30/70 threshold is a flat plateau across lookbacks
  7→21; only the extreme corner (period 21 @ 20/80) degrades.

**The defaults are robust, not overfit.** Because every cell still trails buy &
hold, the sweep confirms *robust mediocrity* — the parameters weren't tuned to
flatter the result.

## Conclusion

1. Triggers are **correctly implemented**.
2. They are **not standalone alpha** on a fair universe over a full cycle.
3. Their value is **risk/drawdown control**, best used as an overlay/regime
   filter rather than as entry signals.
4. Default parameters are **robust to reasonable variation**.

The app's current framing — descriptive technical indicators with disclaimers —
is appropriate. No product code change is warranted by these findings.

## Caveats

Single 2016→2026 window (no walk-forward); Alpaca bars are split- but not
dividend-adjusted (understates total return, more so for high-yield names);
long/flat only, equal-weight, no shorting; fixed 10 bps cost.
