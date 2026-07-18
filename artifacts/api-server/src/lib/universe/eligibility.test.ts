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
