import { describe, it, expect } from "vitest";
import { benchmarkForCap, LARGE_CAP_MIN_MARKET_CAP } from "./benchmark.js";

describe("benchmarkForCap (size-matched event-study benchmark, #33)", () => {
  it("small and microcaps fit against IWM", () => {
    expect(benchmarkForCap(400_000_000)).toBe("IWM");
    expect(benchmarkForCap(9_999_999_999)).toBe("IWM");
  });

  it("large caps fit against SPY (boundary inclusive)", () => {
    expect(benchmarkForCap(LARGE_CAP_MIN_MARKET_CAP)).toBe("SPY");
    expect(benchmarkForCap(3_000_000_000_000)).toBe("SPY");
  });

  it("unknown market cap defaults to IWM — the universe skews small", () => {
    expect(benchmarkForCap(null)).toBe("IWM");
  });
});
