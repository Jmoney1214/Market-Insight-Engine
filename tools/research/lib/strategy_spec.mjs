// SINGLE SOURCE OF TRUTH for the intraday long strategy constants.
//
// Three artifacts must agree on these numbers, or the desk lies to itself:
//   1. the Node engine  (lib/engine.mjs — live scanning + backtest truth)
//   2. the Pine twins    (tools/pine/morning_scan_*.pine — what runs in TradingView)
//   3. the shipped classifier (artifacts/api-server/src/lib/classify.ts)
//
// pine_node_consistency.test.mjs binds (1) and (2) to THIS file automatically,
// so a hand-edit to a Pine constant that forgets the engine (or vice-versa)
// fails CI instead of silently trading a different strategy than it backtested.
//
// This module is a LEAF: it imports nothing, so it can never drift by inheriting
// a stale value. Units follow the Pine convention (percent as whole numbers)
// because the Pine files are the operator-facing surface; the engine's internal
// fractions are mapped in the test.

export const STRATEGY_SPEC = {
  // Scan filter — a day must clear all of these to be tradeable at all.
  scan: {
    gapUpMin: 1.5, // min gap up % at the open (long-only: fall days are declined)
    mtdMin: 7, // min multi-trade days within the lookback
    mtdLookback: 10, // sessions of history for the multi-trade-day count
    rangeThresh: 2, // a session "ranged" if its high-low >= this %
    pmDollarMin: 2_000_000, // min pre-market DOLLAR volume (0 disables)
    priceCeil: 150, // rider ceiling; the scalper class trades above it
  },

  // Class boundaries — which engine a qualified symbol routes to.
  klass: {
    riderRange: 6.5, // avg daily range % floor for the rider class
    riderPriceFloor: 20, // rider needs a real share price, not a sub-$20 mover
    scalperDollarVol: 8e9, // large-cap scalper: >= $8B/day dollar volume
    cautionRange: 4.5, // below this the day is "caution", not tradeable
  },

  // Execution — identical across both classes.
  exec: {
    equity: 25000,
    riskPct: 1, // % of equity risked per trade (÷ stop distance = size)
    notionalCapPct: 50, // max position as % of equity
    stopBufPct: 0.8, // structural stop this % below the pullback low
    commissionPct: 0.02, // per side, TradingView "percent" units (= 2 bps)
    slippageTicks: 2, // TradingView tester slippage
  },

  // Session windows (ET).
  session: {
    entry: "0940-1100", // TradingView input.session string
    flatten: "1550-1600",
    entryStartHm: "09:40", // engine string-compare bounds (end-exclusive at 11:00)
    entryEndHm: "11:00",
    flattenHm: "15:50", // hard EOD flatten begins
  },

  indicators: { emaFast: 9, emaSlow: 20 },

  // Per-class execution differences. rrTarget is the Pine input default:
  // 0 = ride to the flatten (engine expresses the same as rr:null), >0 = fixed R.
  classes: {
    rider: { maxTrades: 1, rrTarget: 0, priceCeiling: true }, // ride to flatten
    scalper: { maxTrades: 3, rrTarget: 1.5, priceCeiling: false }, // 1.5R targets
  },
};
