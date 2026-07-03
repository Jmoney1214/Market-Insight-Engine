import { describe, it, expect } from "vitest";
import { sma, rsi, atr, rangeStats, support, resistance, changeOverBars } from "./indicators.js";

describe("sma", () => {
  it("averages the last `period` values", () => {
    expect(sma([1, 2, 3, 4, 5], 5)).toBe(3);
    expect(sma([1, 2, 3, 4, 5], 2)).toBe(4.5);
  });
  it("returns null with insufficient data", () => {
    expect(sma([1, 2], 3)).toBeNull();
  });
});

describe("rsi", () => {
  it("returns 100 when there are only gains", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(rsi(closes, 14)).toBe(100);
  });
  it("returns 0 when there are only losses", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 - i);
    expect(rsi(closes, 14)).toBe(0);
  });
  it("returns neutral 50 on completely flat price action", () => {
    const closes = Array.from({ length: 20 }, () => 100);
    expect(rsi(closes, 14)).toBe(50);
  });
  it("stays within 0-100 on mixed data", () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 5);
    const v = rsi(closes, 14)!;
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(100);
  });
  it("returns null with insufficient data", () => {
    expect(rsi([1, 2, 3], 14)).toBeNull();
  });
});

describe("atr", () => {
  it("equals the constant true range when ranges never vary", () => {
    const n = 30;
    const highs = Array.from({ length: n }, () => 11);
    const lows = Array.from({ length: n }, () => 9);
    const closes = Array.from({ length: n }, () => 10);
    expect(atr(highs, lows, closes, 14)).toBeCloseTo(2, 10);
  });
  it("returns null with insufficient data", () => {
    expect(atr([1, 2], [0, 1], [1, 1], 14)).toBeNull();
  });
});

describe("rangeStats", () => {
  it("computes average range % and >=threshold day count", () => {
    const n = 10;
    const closes = Array.from({ length: n }, () => 100);
    const highs = Array.from({ length: n }, () => 101.5);
    const lows = Array.from({ length: n }, () => 98.5); // 3% range every day
    const rs = rangeStats(highs, lows, closes, 10, 2)!;
    expect(rs.avgRangePct).toBeCloseTo(3, 6);
    expect(rs.daysAboveThreshold).toBe(10);
  });
  it("counts only days at or above the threshold", () => {
    const closes = Array.from({ length: 10 }, () => 100);
    const highs = closes.map((_, i) => (i < 4 ? 100.5 : 101.5)); // 4 days 1%, 6 days 3%
    const lows = closes.map(() => 98.5);
    // ranges: 4 days of 2.0%? (100.5-98.5)=2 -> exactly 2% counts as above
    const rs = rangeStats(highs, lows, closes, 10, 2)!;
    expect(rs.daysAboveThreshold).toBe(10); // 2% days meet the >= threshold too
    const strict = rangeStats(highs, lows, closes, 10, 2.5)!;
    expect(strict.daysAboveThreshold).toBe(6);
  });
  it("returns null with insufficient data", () => {
    expect(rangeStats([1], [1], [1], 10)).toBeNull();
  });
});

describe("support / resistance", () => {
  it("finds lookback extremes", () => {
    const lows = [5, 4, 6, 3, 7];
    const highs = [8, 9, 12, 10, 11];
    expect(support(lows, 5)).toBe(3);
    expect(resistance(highs, 5)).toBe(12);
  });
});

describe("changeOverBars", () => {
  it("computes % change vs `bars` ago", () => {
    const closes = [100, 105, 110];
    expect(changeOverBars(closes, 2)).toBeCloseTo(10, 6);
  });
  it("returns null when history is too short", () => {
    expect(changeOverBars([100, 110], 2)).toBeNull();
  });
});
