import { describe, expect, it } from "vitest";
import {
  classifyPriceLocation,
  computeFeatures,
  computeOpeningRange,
  computeRvol,
  computeSpreadBps,
  computeVwap,
} from "./features";
import { getFixture } from "./fixtures";
import type { Bar } from "./types";

const bar = (
  t: number,
  o: number,
  h: number,
  l: number,
  c: number,
  v: number,
): Bar => ({ t, o, h, l, c, v });

describe("computeVwap", () => {
  it("is the volume-weighted typical price", () => {
    const bars = [bar(0, 10, 12, 8, 10, 100), bar(1, 10, 11, 9, 10, 100)];
    expect(computeVwap(bars)).toBe(10);
  });

  it("returns null with no bars", () => {
    expect(computeVwap([])).toBeNull();
  });
});

describe("computeRvol", () => {
  it("compares the latest volume to the mean of prior volumes", () => {
    const bars = [
      bar(0, 10, 10, 10, 10, 100),
      bar(1, 10, 10, 10, 10, 100),
      bar(2, 10, 10, 10, 10, 100),
      bar(3, 10, 10, 10, 10, 100),
      bar(4, 10, 10, 10, 10, 300),
    ];
    expect(computeRvol(bars)).toBe(3);
  });

  it("returns null below the minimum bar count", () => {
    expect(computeRvol([bar(0, 10, 10, 10, 10, 100)])).toBeNull();
  });
});

describe("computeOpeningRange", () => {
  it("uses the first three bars by default", () => {
    const bars = [
      bar(0, 10, 12, 8, 10, 1),
      bar(1, 10, 11, 9, 10, 1),
      bar(2, 10, 13, 7, 10, 1),
      bar(3, 10, 20, 1, 10, 1),
    ];
    expect(computeOpeningRange(bars)).toEqual({ high: 13, low: 7 });
  });
});

describe("computeSpreadBps", () => {
  it("computes basis points from bid/ask", () => {
    expect(
      computeSpreadBps({ bid: 100, ask: 100.5, last: 100.25, quoteTime: 0 }),
    ).toBe(49.88);
  });

  it("returns null without bid/ask", () => {
    expect(
      computeSpreadBps({ bid: null, ask: null, last: 100, quoteTime: 0 }),
    ).toBeNull();
  });
});

describe("classifyPriceLocation", () => {
  it("classifies relative to opening range and VWAP", () => {
    expect(classifyPriceLocation(105, 100, 104, 96)).toBe("ABOVE_OPENING_RANGE");
    expect(classifyPriceLocation(95, 100, 104, 96)).toBe("BELOW_OPENING_RANGE");
    expect(classifyPriceLocation(101, 100, 104, 96)).toBe(
      "ABOVE_VWAP_INSIDE_RANGE",
    );
    expect(classifyPriceLocation(99, 100, 104, 96)).toBe(
      "BELOW_VWAP_INSIDE_RANGE",
    );
    expect(classifyPriceLocation(100, 100, 104, 96)).toBe("AT_VWAP");
    expect(classifyPriceLocation(null, 100, 104, 96)).toBeNull();
  });
});

describe("computeFeatures on the clean fixture", () => {
  const fixture = getFixture("AAPL")!;
  const features = computeFeatures(fixture.bars, fixture.quote);

  it("derives the expected deterministic snapshot", () => {
    expect(features.price).toBe(103.95);
    expect(features.vwap).toBe(102.2206);
    expect(features.rvol).toBe(4.412);
    expect(features.openingRangeHigh).toBe(100.5);
    expect(features.openingRangeLow).toBe(99.5);
    expect(features.atr).toBe(0.14);
    expect(features.volumeExpansion).toBe(true);
    expect(features.priceLocation).toBe("ABOVE_OPENING_RANGE");
    expect(features.change1d).toBe(3.95);
  });
});
