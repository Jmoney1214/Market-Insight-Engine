// artifacts/api-server/src/lib/universe/buildUniverse.test.ts
import { describe, it, expect } from "vitest";
import { shouldAbortRebuild, joinRows, applyFloat } from "./buildUniverse.js";
import type { UniverseScreenerRow } from "../providers/fmp.js";
import type { FloatBySymbol } from "../providers/fmp.js";
import type { AlpacaAsset } from "../providers/alpacaAssets.js";

describe("shouldAbortRebuild", () => {
  const screenerRow: UniverseScreenerRow = {
    symbol: "RUNR", name: "Runner Inc", price: 4.25, volume: 8_000_000, marketCap: 1.2e8,
    sector: "Healthcare", industry: "Biotech", exchange: "NASDAQ", isEtf: false, isFund: false, isAdr: false,
  };
  const assetObj: AlpacaAsset = {
    symbol: "RUNR", name: "Runner", exchange: "NASDAQ", class: "us_equity", status: "active",
    tradable: true, shortable: false, easyToBorrow: false, marginable: true, fractionable: true,
  };
  it("aborts when the broker asset list is missing (can't confirm tradability)", () => {
    expect(shouldAbortRebuild(null, [])).toBe(true);
  });
  it("aborts when the screener is missing (no prices)", () => {
    expect(shouldAbortRebuild([], null)).toBe(true);
  });
  it("aborts when the broker asset list is empty (broken feed would wipe every eligible row)", () => {
    expect(shouldAbortRebuild([screenerRow], [])).toBe(true);
    expect(shouldAbortRebuild([], [])).toBe(true);
  });
  it("proceeds when assets are present even if the screener is empty (harmless no-op)", () => {
    expect(shouldAbortRebuild([], [assetObj])).toBe(false);
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

  // BUG 005 — dual-class symbols: FMP screener emits "BF-B" (dash), Alpaca
  // /v2/assets emits "BF.B" (dot). The join must normalize to the broker (dot)
  // form so dual-class names aren't silently dropped as NOT_BROKER_TRADABLE.
  const bfScreen: UniverseScreenerRow = {
    symbol: "BF-B", name: "Brown-Forman Class B", price: 45, volume: 2_000_000, marketCap: 2.1e10,
    sector: "Consumer Defensive", industry: "Beverages", exchange: "NYSE", isEtf: false, isFund: false, isAdr: false,
  };
  const bfAsset: AlpacaAsset = {
    symbol: "BF.B", name: "Brown-Forman", exchange: "NYSE", class: "us_equity", status: "active",
    tradable: true, shortable: true, easyToBorrow: true, marginable: true, fractionable: true,
  };
  it("joins a dual-class name across the FMP dash / Alpaca dot skew and persists the broker (dot) form", () => {
    const out = joinRows([bfScreen], [bfAsset], new Set(), "2026-07-18T23:00:00Z");
    expect(out).toHaveLength(1);
    expect(out[0]!.symbol).toBe("BF.B");
    expect(out[0]!.eligible).toBe(true);
    expect(out[0]!.tradable).toBe(true);
    expect(out[0]!.securityType).toBe("COMMON");
  });
  it("a plain single-form symbol still joins unchanged", () => {
    const out = joinRows([screen], [asset], new Set(), "2026-07-18T23:00:00Z");
    expect(out[0]!.symbol).toBe("RUNR");
    expect(out[0]!.eligible).toBe(true);
  });
  it("preserves the IPO flag using the ORIGINAL FMP symbol form", () => {
    const out = joinRows([bfScreen], [bfAsset], new Set(["BF-B"]), "2026-07-18T23:00:00Z");
    expect(out[0]!.symbol).toBe("BF.B");
    expect(out[0]!.isRecentIpo).toBe(true);
  });
});

describe("applyFloat (FMP dash / broker dot skew)", () => {
  const asset: AlpacaAsset = {
    symbol: "AAPL", name: "Apple", exchange: "NASDAQ", class: "us_equity", status: "active",
    tradable: true, shortable: true, easyToBorrow: true, marginable: true, fractionable: true,
  };
  const screen: UniverseScreenerRow = {
    symbol: "AAPL", name: "Apple Inc", price: 42, volume: 50_000_000, marketCap: 2.5e12,
    sector: "Technology", industry: "Consumer Electronics", exchange: "NASDAQ", isEtf: false, isFund: false, isAdr: false,
  };
  const bfScreen: UniverseScreenerRow = {
    symbol: "BF-B", name: "Brown-Forman Class B", price: 45, volume: 2_000_000, marketCap: 2.1e10,
    sector: "Consumer Defensive", industry: "Beverages", exchange: "NYSE", isEtf: false, isFund: false, isAdr: false,
  };
  const bfAsset: AlpacaAsset = {
    symbol: "BF.B", name: "Brown-Forman", exchange: "NYSE", class: "us_equity", status: "active",
    tradable: true, shortable: true, easyToBorrow: true, marginable: true, fractionable: true,
  };

  it("applies float to a broker-dot symbol via its FMP-dash float key", () => {
    const rows = joinRows([bfScreen], [bfAsset], new Set(), "2026-07-18T23:00:00Z");
    const floatMap: FloatBySymbol = new Map([["BF-B", { floatShares: 10_000_000, sharesOutstanding: 50_000_000 }]]);
    applyFloat(rows, floatMap);
    expect(rows[0]!.floatShares).toBe(10_000_000);
    expect(rows[0]!.floatBucket).toBe("LOW");
    expect(rows[0]!.lowFloat).toBe(true);
    expect(rows[0]!.floatPct).toBeCloseTo(0.2);
    expect(rows[0]!.metadataIncomplete).toBe(false);
  });
  it("applies float to a plain symbol keyed identically", () => {
    const rows = joinRows([screen], [asset], new Set(), "2026-07-18T23:00:00Z");
    const floatMap: FloatBySymbol = new Map([["AAPL", { floatShares: 15_000_000_000, sharesOutstanding: 15_500_000_000 }]]);
    applyFloat(rows, floatMap);
    expect(rows[0]!.floatShares).toBe(15_000_000_000);
    expect(rows[0]!.floatBucket).toBe("HIGH");
    expect(rows[0]!.lowFloat).toBe(false);
  });
});
