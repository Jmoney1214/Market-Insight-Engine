import { describe, it, expect } from "vitest";
import { classifySecurityType } from "./eligibility.js";

describe("classifySecurityType", () => {
  const base = { fmpIsEtf: false, fmpIsFund: false, fmpIsAdr: false };

  it("plain common stock is COMMON", () => {
    expect(classifySecurityType({ symbol: "AAPL", ...base })).toBe("COMMON");
  });
  it("dual-class common (BRK.B) is COMMON, not preferred", () => {
    expect(classifySecurityType({ symbol: "BRK.B", ...base })).toBe("COMMON");
  });
  it("FMP ETF flag wins", () => {
    expect(classifySecurityType({ symbol: "SPY", ...base, fmpIsEtf: true })).toBe("ETF");
  });
  it("FMP fund flag wins", () => {
    expect(classifySecurityType({ symbol: "PHK", ...base, fmpIsFund: true })).toBe("FUND");
  });
  it("warrant suffix .WS is WARRANT", () => {
    expect(classifySecurityType({ symbol: "ABCD.WS", ...base })).toBe("WARRANT");
  });
  it("unit suffix .U is UNIT", () => {
    expect(classifySecurityType({ symbol: "ABCD.U", ...base })).toBe("UNIT");
  });
  it("preferred suffix -PA is PREFERRED", () => {
    expect(classifySecurityType({ symbol: "ABC-PA", ...base })).toBe("PREFERRED");
  });
  it("rights suffix .R is WARRANT-family (non-common)", () => {
    expect(classifySecurityType({ symbol: "ABCD.R", ...base })).toBe("WARRANT");
  });
  it("ADR flag when no disqualifying suffix is ADR", () => {
    expect(classifySecurityType({ symbol: "BABA", ...base, fmpIsAdr: true })).toBe("ADR");
  });
});

import { floatBucket, isRecentIpo } from "./eligibility.js";

describe("floatBucket", () => {
  it("null float is UNKNOWN", () => expect(floatBucket(null)).toBe("UNKNOWN"));
  it("3M is NANO", () => expect(floatBucket(3_000_000)).toBe("NANO"));
  it("5M is LOW (boundary, not NANO)", () => expect(floatBucket(5_000_000)).toBe("LOW"));
  it("19M is LOW", () => expect(floatBucket(19_000_000)).toBe("LOW"));
  it("20M is MID (boundary)", () => expect(floatBucket(20_000_000)).toBe("MID"));
  it("74M is MID", () => expect(floatBucket(74_000_000)).toBe("MID"));
  it("75M is HIGH (boundary)", () => expect(floatBucket(75_000_000)).toBe("HIGH"));
});

describe("isRecentIpo", () => {
  const now = "2026-07-18T12:00:00Z";
  it("null ipoDate is false", () => expect(isRecentIpo(null, now)).toBe(false));
  it("IPO 10 days ago is recent", () => expect(isRecentIpo("2026-07-08", now)).toBe(true));
  it("IPO 100 days ago is not recent", () => expect(isRecentIpo("2026-04-09", now)).toBe(false));
  it("IPO exactly 90 days ago is recent (inclusive)", () => expect(isRecentIpo("2026-04-19", now)).toBe(true));
});

import { evaluateEligibility } from "./eligibility.js";
import type { EligibilityInput } from "./types.js";

const ok: EligibilityInput = {
  brokerTradable: true, exchange: "NASDAQ", securityType: "COMMON", price: 4.5, priceIsFresh: true,
};

describe("evaluateEligibility", () => {
  it("all gates pass -> eligible", () => {
    expect(evaluateEligibility(ok)).toEqual({ eligible: true, reason: null });
  });
  it("not broker tradable -> NOT_BROKER_TRADABLE", () => {
    expect(evaluateEligibility({ ...ok, brokerTradable: false })).toEqual({ eligible: false, reason: "NOT_BROKER_TRADABLE" });
  });
  it("wrong exchange -> NOT_BROKER_TRADABLE", () => {
    expect(evaluateEligibility({ ...ok, exchange: "ARCA" })).toEqual({ eligible: false, reason: "NOT_BROKER_TRADABLE" });
  });
  it("AMEX is allowed", () => {
    expect(evaluateEligibility({ ...ok, exchange: "AMEX" }).eligible).toBe(true);
  });
  it("non-common -> NON_COMMON", () => {
    expect(evaluateEligibility({ ...ok, securityType: "WARRANT" })).toEqual({ eligible: false, reason: "NON_COMMON" });
  });
  it("below band -> OUT_OF_BAND", () => {
    expect(evaluateEligibility({ ...ok, price: 0.9 })).toEqual({ eligible: false, reason: "OUT_OF_BAND" });
  });
  it("above band -> OUT_OF_BAND", () => {
    expect(evaluateEligibility({ ...ok, price: 60 })).toEqual({ eligible: false, reason: "OUT_OF_BAND" });
  });
  it("band is inclusive at $1 and $50", () => {
    expect(evaluateEligibility({ ...ok, price: 1 }).eligible).toBe(true);
    expect(evaluateEligibility({ ...ok, price: 50 }).eligible).toBe(true);
  });
  it("null or stale price -> STALE_QUOTE", () => {
    expect(evaluateEligibility({ ...ok, price: null })).toEqual({ eligible: false, reason: "STALE_QUOTE" });
    expect(evaluateEligibility({ ...ok, priceIsFresh: false })).toEqual({ eligible: false, reason: "STALE_QUOTE" });
  });
});
