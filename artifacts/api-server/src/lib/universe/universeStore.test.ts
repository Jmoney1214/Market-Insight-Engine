// artifacts/api-server/src/lib/universe/universeStore.test.ts
import { describe, it, expect } from "vitest";
import { isEligibleFromRow, conflictUpdateAllExcept, droppedIneligibleQuery } from "./universeStore.js";
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

  it("preserves listed columns: they are excluded from the SET so ON CONFLICT keeps last-good", () => {
    const set = conflictUpdateAllExcept("symbol", ["floatShares", "floatBucket"]);
    const keys = Object.keys(set);
    expect(keys).not.toContain("symbol");
    expect(keys).not.toContain("floatShares");
    expect(keys).not.toContain("floatBucket");
    expect(keys).toContain("eligible"); // non-preserved columns are still overwritten

    const q = db
      .insert(symbolsTable)
      .values([{ symbol: "RUNR", eligible: true } as any])
      .onConflictDoUpdate({ target: symbolsTable.symbol, set });
    const { sql: text } = q.toSQL();
    expect(text).not.toContain('"float_shares" ='); // preserved: never re-assigned on conflict
    expect(text).not.toContain('"float_bucket" =');
    expect(text).toContain('"eligible" =');         // non-preserved: overwritten
  });
});

// BUG 003 — the universe never shrinks: a symbol that drops out of the screener
// (rips above the band, delists, stops trading) was never revisited and kept
// eligible=true forever. After a successful rebuild we reconcile: flip every
// still-eligible row from a PRIOR rebuild to DROPPED_FROM_SCREENER.
describe("droppedIneligibleQuery (reconcile dropped symbols)", () => {
  it("sets eligible=false + DROPPED_FROM_SCREENER, scoped to prior-rebuild eligible rows", () => {
    const at = new Date("2026-07-18T23:00:00Z");
    const { sql: text, params } = droppedIneligibleQuery(at).toSQL();

    // SET clause: eligible -> false, reason stamped, stale marked.
    expect(text).toContain('set "eligible" =');
    expect(text).toContain('"ineligible_reason" =');
    expect(text).toContain('"stale_since" =');
    expect(params).toContain(false);                    // eligible = false
    expect(params).toContain("DROPPED_FROM_SCREENER");  // ineligible_reason

    // WHERE clause: only currently-eligible rows whose last_full_refresh is
    // missing or older than this rebuild (the just-upserted batch is == at, so
    // it is untouched).
    expect(text).toContain('"symbols"."eligible" =');            // eligible = true guard
    expect(text).toContain('"symbols"."last_full_refresh" is null');
    expect(text).toContain('"symbols"."last_full_refresh" <');   // strictly older than this rebuild
    expect(params).toContain(true);                              // WHERE eligible = true
  });
});
