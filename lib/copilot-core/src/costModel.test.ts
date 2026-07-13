import { describe, it, expect } from "vitest";
import { estimateTransactionCost, analyzeSlippage, IMPACT_COEF_BP } from "./costModel";

describe("estimateTransactionCost", () => {
  it("decomposes spread + impact + fees and scales round-trip correctly", () => {
    const est = estimateTransactionCost({
      price: 10,
      spreadBp: 20,
      avgDailyVolume: 1_000_000,
      orderShares: 10_000, // 1% ADV
      feePerShareUsd: 0.005,
    })!;
    expect(est.spreadCostBp).toBe(10); // half of quoted spread
    expect(est.impactBp).toBeCloseTo(IMPACT_COEF_BP * Math.sqrt(0.01), 1); // 9bp
    expect(est.feesBp).toBeCloseTo(5, 2); // $0.005 on $10 = 5bp
    expect(est.perSideBp).toBeCloseTo(est.spreadCostBp + est.impactBp + est.feesBp, 1);
    expect(est.roundTripBp).toBeCloseTo(est.perSideBp * 2, 1);
    // USD: roundTripBp of $100k notional
    expect(est.roundTripUsd).toBeCloseTo((est.roundTripBp / 10_000) * 100_000, 1);
    expect(est.participation).toBe(0.01);
  });

  it("wide-spread microcap is dominated by spread cost (the NVVE case)", () => {
    const est = estimateTransactionCost({ price: 2, spreadBp: 260, avgDailyVolume: 300_000, orderShares: 3_000 })!;
    expect(est.spreadCostBp).toBe(130);
    expect(est.spreadCostBp).toBeGreaterThan(est.impactBp);
    expect(est.roundTripBp).toBeGreaterThan(260);
  });

  it("returns null on invalid inputs instead of fabricating", () => {
    expect(estimateTransactionCost({ price: 0, spreadBp: 10, avgDailyVolume: 1, orderShares: 1 })).toBeNull();
    expect(estimateTransactionCost({ price: 10, spreadBp: -1, avgDailyVolume: 1, orderShares: 1 })).toBeNull();
    expect(estimateTransactionCost({ price: 10, spreadBp: 1, avgDailyVolume: 0, orderShares: 1 })).toBeNull();
  });
});

describe("analyzeSlippage", () => {
  it("BUY above expected = positive slippage; SELL below expected = positive slippage", () => {
    const buy = analyzeSlippage({ side: "BUY", expectedPrice: 10, fillPrice: 10.05, shares: 100 })!;
    expect(buy.slippageBp).toBeCloseTo(50, 0);
    expect(buy.slippageUsd).toBeCloseTo(5, 1);
    const sell = analyzeSlippage({ side: "SELL", expectedPrice: 10, fillPrice: 9.95, shares: 100 })!;
    expect(sell.slippageBp).toBeCloseTo(50, 0);
  });

  it("favorable fills are negative slippage", () => {
    const buy = analyzeSlippage({ side: "BUY", expectedPrice: 10, fillPrice: 9.98, shares: 100 })!;
    expect(buy.slippageBp).toBeLessThan(0);
  });

  it("compares realized vs the cost model when provided", () => {
    const r = analyzeSlippage({ side: "BUY", expectedPrice: 10, fillPrice: 10.03, shares: 100, expectedPerSideBp: 20 })!;
    expect(r.vsModelBp).toBeCloseTo(10, 0); // 30bp realized vs 20bp modeled
  });

  it("returns null on invalid inputs", () => {
    expect(analyzeSlippage({ side: "BUY", expectedPrice: 0, fillPrice: 1, shares: 1 })).toBeNull();
  });
});
