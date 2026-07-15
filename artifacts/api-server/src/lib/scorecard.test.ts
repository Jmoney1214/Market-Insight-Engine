import { describe, it, expect } from "vitest";
import { gradeRow } from "./scorecard.js";

// gradeRow reconstructs the pre-market reference close from (priceAtScan, gapPct):
// refClose = priceAtScan / (1 + gapPct/100).

describe("gradeRow", () => {
  it("intraday pick hits when the session ranged >= 2%", () => {
    const g = gradeRow("intraday", 0, 100, { high: 102, low: 99.5, close: 100 });
    expect(g.rangePct).toBeCloseTo(2.5, 6);
    expect(g.hit).toBe(true);
  });

  it("intraday pick misses on a tight session", () => {
    const g = gradeRow("intraday", 0, 100, { high: 100.5, low: 99.7, close: 100 });
    expect(g.hit).toBe(false);
  });

  it("jump pick hits when the session closes above the pre-market reference", () => {
    // Scanned at 105 on a +5% gap -> refClose = 100. Closed at 103: up move held.
    const g = gradeRow("jump", 5, 105, { high: 106, low: 101, close: 103 });
    expect(g.changePct).toBeCloseTo(3, 6);
    expect(g.hit).toBe(true);
  });

  it("jump pick misses when the gap fully fades", () => {
    // Scanned at 105 on +5% gap (ref 100), but closed at 98.
    const g = gradeRow("jump", 5, 105, { high: 105.5, low: 97, close: 98 });
    expect(g.changePct).toBeCloseTo(-2, 6);
    expect(g.hit).toBe(false);
  });

  // LONG-ONLY (invert bearish to buy): a "fall" pick is a gap-down name taken
  // as an inverted long dip-buy, so a hit is UPSIDE, not the old short-side down.
  it("fall pick (inverted long) MISSES when it keeps falling", () => {
    // Scanned at 95 on a -5% gap -> refClose = 100. Closed 93: the dip-buy lost.
    const g = gradeRow("fall", -5, 95, { high: 96, low: 92, close: 93 });
    expect(g.changePct).toBeCloseTo(-7, 6);
    expect(g.hit).toBe(false);
  });

  it("fall pick (inverted long) HITS when the stock reverses and closes up", () => {
    const g = gradeRow("fall", -5, 95, { high: 103, low: 94, close: 102 });
    expect(g.changePct).toBeCloseTo(2, 6);
    expect(g.hit).toBe(true);
  });
});
