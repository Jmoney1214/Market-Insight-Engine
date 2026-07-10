// Tick-rule signed volume — null without a tape (never inferred from bars),
// standard tick-test classification, and honest handling of unclassifiable
// leading trades.

import { describe, it, expect } from "vitest";
import {
  computeOrderFlow,
  BUY_PRESSURE_RATIO,
  SELL_PRESSURE_RATIO,
} from "./orderFlow";
import type { Trade } from "./types";

const tr = (p: number, s: number, t = 0): Trade => ({ t, p, s });

describe("computeOrderFlow", () => {
  it("returns null with no tape — order flow is never derived from bars", () => {
    expect(computeOrderFlow(null)).toBeNull();
    expect(computeOrderFlow(undefined)).toBeNull();
    expect(computeOrderFlow([])).toBeNull();
  });

  it("classifies upticks as buying pressure", () => {
    const f = computeOrderFlow([tr(100, 100), tr(100.01, 200), tr(100.02, 300)])!;
    expect(f.buyVolume).toBe(500);
    expect(f.sellVolume).toBe(0);
    expect(f.delta).toBe(500);
    expect(f.buyRatio).toBe(1);
    expect(f.pressure).toBe("BUYING");
  });

  it("classifies downticks as selling pressure", () => {
    const f = computeOrderFlow([tr(100, 100), tr(99.99, 200), tr(99.98, 300)])!;
    expect(f.sellVolume).toBe(500);
    expect(f.buyVolume).toBe(0);
    expect(f.pressure).toBe("SELLING");
  });

  it("zero-ticks inherit the previous direction (standard tick test)", () => {
    const f = computeOrderFlow([
      tr(100, 100),
      tr(100.01, 200), // uptick → buy
      tr(100.01, 300), // zero-tick → inherits buy
    ])!;
    expect(f.buyVolume).toBe(500);
    expect(f.sellVolume).toBe(0);
  });

  it("the first trade and leading zero-ticks stay unclassified", () => {
    const f = computeOrderFlow([tr(100, 500), tr(100, 500), tr(100, 500)])!;
    expect(f.buyVolume).toBe(0);
    expect(f.sellVolume).toBe(0);
    expect(f.buyRatio).toBe(0.5);
    expect(f.pressure).toBe("BALANCED");
    expect(f.tradeCount).toBe(3);
  });

  it("a two-sided tape reads BALANCED between the pressure thresholds", () => {
    const f = computeOrderFlow([
      tr(100, 100),
      tr(100.01, 500),
      tr(100.0, 500),
      tr(100.01, 500),
      tr(100.0, 500),
    ])!;
    expect(f.buyRatio).toBeGreaterThan(SELL_PRESSURE_RATIO);
    expect(f.buyRatio).toBeLessThan(BUY_PRESSURE_RATIO);
    expect(f.pressure).toBe("BALANCED");
  });

  it("skips malformed trades instead of poisoning the totals", () => {
    const f = computeOrderFlow([
      tr(100, 100),
      { t: 0, p: NaN, s: 100 },
      { t: 0, p: 100.01, s: -5 },
      tr(100.01, 200),
    ])!;
    expect(f.buyVolume).toBe(200);
    expect(f.sellVolume).toBe(0);
  });

  it("is deterministic: identical tape → identical read", () => {
    const tape = [tr(100, 100), tr(100.01, 200), tr(99.99, 300)];
    expect(computeOrderFlow(tape)).toEqual(computeOrderFlow(tape));
  });
});
