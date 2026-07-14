// LONG-ONLY invariant tests (operator directive: invert bearish to buy).
//
// These pin the product invariant so a future edit can never reintroduce a
// short: the Direction/PositionSide unions are LONG-only, inferDirection never
// returns SHORT (bearish structure inverts to a long), and computeRiskReward
// only ever previews a long (entry below the target, stop below the entry).
import { describe, it, expect } from "vitest";
import { inferDirection } from "./triggers";
import { computeRiskReward } from "./riskReward";
import type { Direction, Features, Trigger } from "./types";

const trig = (name: string, detected: boolean): Trigger => ({
  name,
  category: "primary_edge",
  detected,
  detail: null,
});

describe("LONG-ONLY: inferDirection never returns SHORT", () => {
  it("a purely bearish stack inverts to LONG, never SHORT", () => {
    const bearish = [
      trig("OPENING_RANGE_FAILURE", true),
      trig("TREND_CONTINUATION_SHORT", true),
      trig("GAP_FADE_SHORT", true),
    ];
    const dir: Direction | null = inferDirection(bearish);
    expect(dir).toBe("LONG");
    // Type-level guarantee: Direction has no "SHORT" member. This line only
    // compiles because the union is LONG-only.
    const _exhaustive: "LONG" | null = dir;
    expect(_exhaustive === "LONG" || _exhaustive === null).toBe(true);
  });

  it("a bullish stack is LONG", () => {
    expect(inferDirection([trig("OPENING_RANGE_BREAKOUT", true)])).toBe("LONG");
  });

  it("no directional edge is null (no forced entry)", () => {
    expect(inferDirection([trig("VOLUME_EXPANSION", false)])).toBeNull();
  });
});

describe("LONG-ONLY: computeRiskReward only previews a long", () => {
  const features: Features = {
    price: 100,
    vwap: 99,
    rvol: 2,
    atr: 2,
    openingRangeHigh: 101,
    openingRangeLow: 98,
    volumeExpansion: true,
    priceLocation: "ABOVE_VWAP",
    spread: 0.01,
    change1d: 1.5,
  };

  it("a LONG preview has target above entry and stop below entry", () => {
    const rr = computeRiskReward(features, "LONG");
    expect(rr.direction).toBe("LONG");
    expect(rr.entry).not.toBeNull();
    expect(rr.target! > rr.entry!).toBe(true); // long: profit is up
    expect(rr.invalidation! < rr.entry!).toBe(true); // long: stop is down
  });

  it("null direction yields no setup (never a short preview)", () => {
    const rr = computeRiskReward(features, null);
    expect(rr.direction).toBeNull();
    expect(rr.target).toBeNull();
  });
});
