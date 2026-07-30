import { describe, it, expect } from "vitest";
import { gradeRow, fallReclaimReady, FALL_RECLAIM_BUFFER_PCT } from "./scorecard.js";

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

// Fall-list reform: gap-downs are watch-only until a reclaim promotion — live
// price back above the first-seen premarket price by the reclaim buffer.
describe("fallReclaimReady", () => {
  it("promotes exactly at the buffer boundary", () => {
    // First seen at 100; buffer 2% -> 102 is the promotion line.
    expect(fallReclaimReady(100, 102)).toBe(true);
    expect(fallReclaimReady(100, 101.99)).toBe(false);
  });

  it("does not promote a name still at or below its first-seen price", () => {
    expect(fallReclaimReady(100, 100)).toBe(false);
    expect(fallReclaimReady(100, 95)).toBe(false);
  });

  it("promotes a strong reclaim well above the buffer", () => {
    expect(fallReclaimReady(50, 53)).toBe(true); // +6%
  });

  it("rejects degenerate recorded prices instead of promoting on garbage", () => {
    expect(fallReclaimReady(0, 10)).toBe(false);
    expect(fallReclaimReady(-5, 10)).toBe(false);
  });

  it("honors a custom buffer", () => {
    expect(fallReclaimReady(100, 103, 3)).toBe(true);
    expect(fallReclaimReady(100, 102.9, 3)).toBe(false);
  });

  it("ships with a 2% buffer — changing it is a strategy change, not a refactor", () => {
    expect(FALL_RECLAIM_BUFFER_PCT).toBe(2);
  });
});

// Reclaim-promoted fall rows grade against their ACTUAL promotion entry, not
// the premarket reference close — for shallow gaps the promotion line sits
// above refClose, and the old anchor stamped HIT on losing entries.
describe("gradeRow with a promoted fall entry", () => {
  it("reviewer scenario: closes above refClose but below the entry — MISS, not hit", () => {
    // Gap -1.5%: scanned 98.5 -> refClose 100. Promoted at 100.47 (+2%).
    // Session closes 100.20: +0.2% vs refClose (old logic: HIT), but the
    // actual trade lost -0.27%.
    const g = gradeRow("fall", -1.5, 98.5, { high: 101, low: 98, close: 100.2 }, 100.47);
    expect(g.changePct).toBeGreaterThan(0); // day-change stays refClose-anchored
    expect(g.hit).toBe(false); // hit is entry-anchored
  });

  it("hits only when the close clears the promotion entry", () => {
    const g = gradeRow("fall", -1.5, 98.5, { high: 102, low: 98, close: 101 }, 100.47);
    expect(g.hit).toBe(true);
  });

  it("watch-only rows (no promotion) keep the refClose anchor", () => {
    const g = gradeRow("fall", -5, 95, { high: 103, low: 94, close: 102 }, null);
    expect(g.hit).toBe(true); // unchanged pre-reform semantics
  });

  it("ignores a degenerate promoted price instead of grading against garbage", () => {
    const g = gradeRow("fall", -5, 95, { high: 103, low: 94, close: 102 }, 0);
    expect(g.hit).toBe(true); // falls back to refClose anchor
  });

  it("jump rows never use the promotion anchor", () => {
    const g = gradeRow("jump", 5, 105, { high: 106, low: 101, close: 103 }, 999);
    expect(g.hit).toBe(true); // still refClose-anchored (+3%)
  });
});
