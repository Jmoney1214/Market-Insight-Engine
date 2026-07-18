// artifacts/api-server/src/lib/universe/universeStore.test.ts
import { describe, it, expect } from "vitest";
import { isEligibleFromRow, conflictUpdateAllExcept } from "./universeStore.js";
import { db, symbolsTable, type SymbolRow } from "@workspace/db";

const row = (over: Partial<SymbolRow>): SymbolRow => ({
  symbol: "RUNR", name: null, exchange: "NASDAQ", securityType: "COMMON",
  eligible: true, ineligibleReason: null, lastPrice: 4, prevClose: null,
  floatShares: null, sharesOutstanding: null, floatPct: null, floatBucket: "UNKNOWN",
  lowFloat: null, avgVolume: null, avgDollarVolume: null, marketCap: null,
  tradable: true, shortable: null, easyToBorrow: null, marginable: null, fractionable: null,
  ssrFlag: null, dilutionRisk: "UNKNOWN", recentOffering: null, recentSplit: null,
  isRecentIpo: false, ipoDate: null, earningsDate: null, sector: null, industry: null,
  sympathyTickers: null, lastFullRefresh: null, lastDailyRefresh: null, staleSince: null,
  metadataIncomplete: false, ...over,
});

describe("isEligibleFromRow", () => {
  it("eligible row", () => {
    expect(isEligibleFromRow(row({ eligible: true }))).toEqual({ eligible: true, reason: null });
  });
  it("ineligible row carries the reason", () => {
    expect(isEligibleFromRow(row({ eligible: false, ineligibleReason: "OUT_OF_BAND" })))
      .toEqual({ eligible: false, reason: "OUT_OF_BAND" });
  });
  it("missing row (undefined) is ineligible NOT_BROKER_TRADABLE", () => {
    expect(isEligibleFromRow(undefined)).toEqual({ eligible: false, reason: "NOT_BROKER_TRADABLE" });
  });
});

describe("upsert conflict set", () => {
  it("overwrites every non-PK column with the EXCLUDED (incoming) value, never a self-assignment", () => {
    const set = conflictUpdateAllExcept("symbol");
    expect(Object.keys(set)).not.toContain("symbol");
    expect(Object.keys(set).length).toBeGreaterThan(20);
    const q = db
      .insert(symbolsTable)
      .values([{ symbol: "RUNR", eligible: true } as any])
      .onConflictDoUpdate({ target: symbolsTable.symbol, set });
    const { sql: text } = q.toSQL();
    expect(text).toContain("excluded");                 // writes the new value
    expect(text).not.toMatch(/"float_shares"\s*=\s*"symbols"/); // NOT self-assignment
  });
});
