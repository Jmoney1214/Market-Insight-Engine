import { describe, it, expect } from "vitest";
import { classifyCandidate } from "./classify.js";

// Boundaries come from research/findings.md case study 3; the example inputs
// are the measured features of the symbols each class was validated on.

describe("classifyCandidate", () => {
  it("classifies hyper-volatile movers >= $20 as rider (HIMS/QBTS/IONQ class)", () => {
    expect(classifyCandidate(7.68, 702e6, 36.8).tradeClass).toBe("rider"); // HIMS
    expect(classifyCandidate(8.99, 846e6, 22.53).tradeClass).toBe("rider"); // QBTS
    expect(classifyCandidate(8.76, 1710e6, 49.12).tradeClass).toBe("rider"); // IONQ
  });

  it("classifies deep-liquidity large caps as scalper (COIN/TSLA/NVDA class)", () => {
    expect(classifyCandidate(3.15, 33.5e9, 194.83).tradeClass).toBe("scalper"); // NVDA
    expect(classifyCandidate(4.03, 22e9, 393.45).tradeClass).toBe("scalper"); // TSLA
  });

  it("caps cheap movers at caution — the class failed validation (PLUG/BBAI/MARA)", () => {
    expect(classifyCandidate(8.11, 242e6, 2.64).tradeClass).toBe("caution"); // PLUG
    expect(classifyCandidate(7.61, 558e6, 12.4).tradeClass).toBe("caution"); // MARA
  });

  it("marks mid-range movers as caution — rider edge decays (CVNA/AFRM class)", () => {
    expect(classifyCandidate(5.45, 864e6, 68.6).tradeClass).toBe("caution"); // CVNA
    expect(classifyCandidate(5.53, 340e6, 84.58).tradeClass).toBe("caution"); // AFRM
  });

  it("marks quiet tape as avoid (F/AAL class)", () => {
    expect(classifyCandidate(3.75, 846e6, 13.36).tradeClass).toBe("avoid"); // F
    expect(classifyCandidate(3.96, 1.3e9, 17.92).tradeClass).toBe("avoid"); // AAL
  });

  it("rider requires BOTH volatility and the $20 floor; scalper needs $8B", () => {
    expect(classifyCandidate(6.5, 1e9, 20).tradeClass).toBe("rider"); // exact boundary
    expect(classifyCandidate(6.49, 1e9, 50).tradeClass).toBe("caution");
    expect(classifyCandidate(3.0, 8e9, 165).tradeClass).toBe("scalper"); // exact boundary
    expect(classifyCandidate(3.0, 7.9e9, 165).tradeClass).toBe("avoid");
  });

  it("classifies by liquidity alone when range stats are missing on a large cap", () => {
    expect(classifyCandidate(null, 33.5e9, 194.83).tradeClass).toBe("scalper"); // NVDA, failed bar fetch
  });

  it("returns null class when range stats are unavailable, with a note either way", () => {
    expect(classifyCandidate(null, 1e9, 50)).toEqual({ tradeClass: null, classNote: null });
    expect(classifyCandidate(7.0, null, 50).tradeClass).toBe("rider");
    expect(classifyCandidate(3.0, null, 50).tradeClass).toBe("avoid");
    for (const c of [classifyCandidate(7, 1e9, 50), classifyCandidate(2, 1e9, 50)]) {
      expect(typeof c.classNote).toBe("string");
    }
  });
});
