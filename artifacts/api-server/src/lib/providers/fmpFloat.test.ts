// artifacts/api-server/src/lib/providers/fmpFloat.test.ts
import { describe, it, expect } from "vitest";
import { accumulateFloatPages } from "./fmp.js";

type Row = Record<string, unknown>;
const row = (symbol: string, floatShares: number, outstandingShares: number): Row => ({
  symbol,
  floatShares,
  outstandingShares,
});

describe("accumulateFloatPages", () => {
  it("accumulates a full page followed by a short page into a populated map", async () => {
    const pageSize = 2;
    const pages: Array<Array<Row> | null> = [
      [row("AAA", 10_000_000, 20_000_000), row("BBB", 5_000_000, 8_000_000)], // full → continue
      [row("CCC", 1_000_000, 2_000_000)], // short → end-of-data
    ];
    const map = await accumulateFloatPages((p) => Promise.resolve(pages[p] ?? []), pageSize, 60);
    expect(map).not.toBeNull();
    expect(map!.size).toBe(3);
    expect(map!.get("AAA")).toEqual({ floatShares: 10_000_000, sharesOutstanding: 20_000_000 });
    expect(map!.get("CCC")).toEqual({ floatShares: 1_000_000, sharesOutstanding: 2_000_000 });
  });

  it("fails closed (returns null, discards the partial) when a page fails mid-pagination", async () => {
    const pageSize = 2;
    const pages: Array<Array<Row> | null> = [
      [row("AAA", 10_000_000, 20_000_000), row("BBB", 5_000_000, 8_000_000)], // full page → continue
      null, // failure at page 1 (rate limit / non-2xx / error payload) — NOT end-of-data
    ];
    const map = await accumulateFloatPages((p) => Promise.resolve(pages[p] ?? null), pageSize, 60);
    expect(map).toBeNull();
  });

  it("fails closed (returns null) when the very first page fails", async () => {
    const map = await accumulateFloatPages(() => Promise.resolve(null), 1000, 60);
    expect(map).toBeNull();
  });
});
