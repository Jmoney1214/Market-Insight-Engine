// artifacts/api-server/src/lib/universe/buildUniverse.test.ts
import { describe, it, expect } from "vitest";
import { shouldAbortRebuild, joinRows } from "./buildUniverse.js";
import type { UniverseScreenerRow } from "../providers/fmp.js";
import type { AlpacaAsset } from "../providers/alpacaAssets.js";

describe("shouldAbortRebuild", () => {
  it("aborts when the broker asset list is missing (can't confirm tradability)", () => {
    expect(shouldAbortRebuild(null, [])).toBe(true);
  });
  it("aborts when the screener is missing (no prices)", () => {
    expect(shouldAbortRebuild([], null)).toBe(true);
  });
  it("proceeds when both sources are present (even if empty arrays)", () => {
    expect(shouldAbortRebuild([], [])).toBe(false);
  });
});

describe("joinRows", () => {
  const asset: AlpacaAsset = {
    symbol: "RUNR", name: "Runner", exchange: "NASDAQ", class: "us_equity", status: "active",
    tradable: true, shortable: false, easyToBorrow: false, marginable: true, fractionable: true,
  };
  const screen: UniverseScreenerRow = {
    symbol: "RUNR", name: "Runner Inc", price: 4.25, volume: 8_000_000, marketCap: 1.2e8,
    sector: "Healthcare", industry: "Biotech", exchange: "NASDAQ", isEtf: false, isFund: false, isAdr: false,
  };
  it("drives off the screener set and joins the matching asset", () => {
    const out = joinRows([screen], [asset], new Set(), "2026-07-18T23:00:00Z");
    expect(out).toHaveLength(1);
    expect(out[0]!.symbol).toBe("RUNR");
    expect(out[0]!.eligible).toBe(true);
  });
  it("screener symbol with no matching asset is NOT_BROKER_TRADABLE", () => {
    const out = joinRows([screen], [], new Set(), "2026-07-18T23:00:00Z");
    expect(out[0]!.eligible).toBe(false);
    expect(out[0]!.ineligibleReason).toBe("NOT_BROKER_TRADABLE");
  });
  it("applies the recent-IPO set", () => {
    const out = joinRows([screen], [asset], new Set(["RUNR"]), "2026-07-18T23:00:00Z");
    expect(out[0]!.isRecentIpo).toBe(true);
  });
});
