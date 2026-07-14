import { describe, it, expect, beforeAll, vi } from "vitest";

// FAIL-CLOSED CONTRACT: with no provider keys, buildReport must THROW —
// never return a fabricated report. Real keys may exist in the dev
// environment, so the tests blank them BEFORE importing: provider config
// reads env at module-import time.

let buildReport: typeof import("./buildReport.js").buildReport;
let NoLiveDataError: typeof import("./buildReport.js").NoLiveDataError;

beforeAll(async () => {
  vi.stubEnv("FMP_API_KEY", "");
  vi.stubEnv("ALPACA_API_KEY_ID", "");
  vi.stubEnv("ALPACA_API_SECRET_KEY", "");
  ({ buildReport, NoLiveDataError } = await import("./buildReport.js"));
});

describe("buildReport without provider keys (fail closed)", () => {
  it("throws NoLiveDataError instead of fabricating a report", async () => {
    await expect(buildReport("aapl", 7)).rejects.toBeInstanceOf(NoLiveDataError);
  });

  it("never returns a mock: there is no code path that yields dataSource 'mock'", async () => {
    // The 'mock' provenance value survives only on legacy DB rows. If this
    // test ever fails because buildReport resolved, the fail-closed guarantee
    // has been broken.
    await expect(buildReport("NVDA", 1)).rejects.toThrow(
      "refusing to fabricate a report",
    );
  });
});

describe("neutralBaseReport (the merge skeleton)", () => {
  it("contains no fabricated values and flags every section as placeholder", async () => {
    const { neutralBaseReport } = await import("./baseReport.js");
    const r = neutralBaseReport("XYZ", 3);
    expect(r.ticker).toBe("XYZ");
    // Not-rated default — never a BUY/SELL/HOLD verdict without data.
    expect(r.overallRating).toBe("WATCH");
    expect(r.actionPlan.rating).toBe("WATCH");
    // Honest emptiness, not plausible numbers.
    expect(r.snapshot.price).toBe(0);
    expect(r.news.headlines).toEqual([]);
    expect(r.filings.keyHighlights).toEqual([]);
    expect(r.financials.revenueHistory).toEqual([]);
    expect(r.valuation.comparables).toEqual([]);
    expect(r.risks.items).toEqual([]);
    expect(r.catalysts.positive).toEqual([]);
    // Placeholder flags all true.
    expect(r.news.isPlaceholder).toBe(true);
    expect(r.filings.isPlaceholder).toBe(true);
    expect(r.financials.isPlaceholder).toBe(true);
    expect(r.valuation.isPlaceholder).toBe(true);
    expect(r.technical.isPlaceholder).toBe(true);
  });

  it("is deterministic — two calls produce identical content (no randomness)", async () => {
    const { neutralBaseReport } = await import("./baseReport.js");
    const a = neutralBaseReport("AAPL", 1);
    const b = neutralBaseReport("AAPL", 1);
    // generatedAt is a timestamp; everything else must match exactly.
    const strip = (r: typeof a) => ({ ...r, generatedAt: "" });
    expect(strip(a)).toEqual(strip(b));
  });
});
