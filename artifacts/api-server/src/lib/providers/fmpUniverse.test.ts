// artifacts/api-server/src/lib/providers/fmpUniverse.test.ts
import { describe, it, expect } from "vitest";
import { mapScreenerRow } from "./fmp.js";

describe("mapScreenerRow", () => {
  it("maps a full row", () => {
    const raw = {
      symbol: "RUNR", companyName: "Runner Inc", price: 4.25, volume: 8_000_000,
      marketCap: 120_000_000, sector: "Healthcare", industry: "Biotech",
      exchangeShortName: "NASDAQ", isEtf: false, isFund: false, isAdr: false,
    };
    expect(mapScreenerRow(raw)).toEqual({
      symbol: "RUNR", name: "Runner Inc", price: 4.25, volume: 8_000_000,
      marketCap: 120_000_000, sector: "Healthcare", industry: "Biotech",
      exchange: "NASDAQ", isEtf: false, isFund: false, isAdr: false,
    });
  });
  it("returns null without a symbol or price", () => {
    expect(mapScreenerRow({ price: 5 })).toBeNull();
    expect(mapScreenerRow({ symbol: "X" })).toBeNull();
  });
});
