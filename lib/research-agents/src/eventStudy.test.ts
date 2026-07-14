import { describe, it, expect } from "vitest";
import { eventStudy, eventStudyFromCloses, fitMarketModel, toReturns, MIN_ESTIMATION_DAYS } from "./eventStudy";

/**
 * Deterministic pseudo-noise (no Math.random — reproducible forever). The two
 * series use DIFFERENT frequencies so they are near-orthogonal; same-frequency
 * phase-shifted sines would be strongly correlated and poison the beta fit.
 */
const marketNoise = (i: number) => Math.sin(i * 12.9898) * 0.004;
const idioNoise = (i: number) => Math.sin(i * 78.233) * 0.001;

const marketReturns = Array.from({ length: 60 }, (_, i) => 0.001 + marketNoise(i));
// Stock follows the market with beta 1.5, alpha 0.0005, plus small idio noise.
const stockReturns = marketReturns.map((m, i) => 0.0005 + 1.5 * m + idioNoise(i));

describe("toReturns", () => {
  it("computes simple returns and rejects non-positive closes", () => {
    const returns = toReturns([100, 110, 99]);
    expect(returns).toHaveLength(2);
    expect(returns[0]).toBeCloseTo(0.1, 10);
    expect(returns[1]).toBeCloseTo(-0.1, 10);
    expect(toReturns([100, 0, 50])).toEqual([]);
  });
});

describe("fitMarketModel", () => {
  it("recovers alpha and beta from a synthetic market-model series", () => {
    const model = fitMarketModel(stockReturns, marketReturns)!;
    expect(model.beta).toBeCloseTo(1.5, 1);
    expect(model.alpha).toBeCloseTo(0.0005, 2);
    expect(model.residualStd).toBeGreaterThan(0);
  });

  it("refuses thin or degenerate estimation windows", () => {
    expect(fitMarketModel(stockReturns.slice(0, MIN_ESTIMATION_DAYS - 1), marketReturns.slice(0, MIN_ESTIMATION_DAYS - 1))).toBeNull();
    expect(fitMarketModel(stockReturns, marketReturns.slice(0, 30))).toBeNull();
    const flat = Array.from({ length: 60 }, () => 0.001);
    expect(fitMarketModel(stockReturns, flat)).toBeNull();
  });
});

describe("eventStudy", () => {
  it("a large abnormal move is significant; a market-explained move is not", () => {
    const big = eventStudy({
      estimationStockReturns: stockReturns,
      estimationMarketReturns: marketReturns,
      eventStockReturns: [0.12, 0.03], // way beyond model noise
      eventMarketReturns: [0.001, 0.001],
    })!;
    expect(big.car).toBeGreaterThan(0.1);
    expect(big.significant).toBe(true);

    const explained = eventStudy({
      estimationStockReturns: stockReturns,
      estimationMarketReturns: marketReturns,
      // Exactly what the model predicts for these market moves → AR ≈ 0.
      eventStockReturns: [0.0005 + 1.5 * 0.002, 0.0005 + 1.5 * -0.001],
      eventMarketReturns: [0.002, -0.001],
    })!;
    expect(Math.abs(explained.car)).toBeLessThan(0.005);
    expect(explained.significant).toBe(false);
  });

  it("returns null on an empty or mismatched event window", () => {
    expect(
      eventStudy({
        estimationStockReturns: stockReturns,
        estimationMarketReturns: marketReturns,
        eventStockReturns: [],
        eventMarketReturns: [],
      }),
    ).toBeNull();
  });
});

describe("eventStudyFromCloses", () => {
  const dates = Array.from({ length: 81 }, (_, i) => `2026-0${Math.floor(i / 28) + 4}-${String((i % 28) + 1).padStart(2, "0")}`);
  // The market must WIGGLE — a constant-growth series has zero return
  // variance and is (correctly) rejected as unestimable.
  let mClose = 100;
  let sClose = 50;
  const eventIdx = 70;
  const market: Array<{ date: string; close: number }> = [];
  const stock: Array<{ date: string; close: number }> = [];
  dates.forEach((date, i) => {
    const mReturn = 0.001 + marketNoise(i);
    mClose *= 1 + mReturn;
    sClose *= (1 + 0.0005 + 1.2 * mReturn + idioNoise(i)) * (i === eventIdx ? 1.15 : 1);
    market.push({ date, close: mClose });
    stock.push({ date, close: sClose });
  });

  it("aligns by date, estimates before the event, grades the jump significant", () => {
    const result = eventStudyFromCloses({ stock, market, eventDate: dates[eventIdx]!, eventDays: 3 })!;
    expect(result.car).toBeGreaterThan(0.1);
    expect(result.significant).toBe(true);
    expect(result.estimationDays).toBeGreaterThanOrEqual(MIN_ESTIMATION_DAYS);
  });

  it("returns null when the event date is beyond the series", () => {
    expect(eventStudyFromCloses({ stock, market, eventDate: "2027-01-01" })).toBeNull();
  });
});
