import { describe, it, expect, beforeAll, vi } from "vitest";

// With no provider keys, buildReport must return the full mock report
// (graceful no-keys fallback) with placeholder flags intact. Real keys may
// exist in the dev environment, so the test blanks them BEFORE importing:
// provider config reads env at module-import time.

let buildReport: typeof import("./buildReport.js").buildReport;

beforeAll(async () => {
  vi.stubEnv("FMP_API_KEY", "");
  vi.stubEnv("ALPACA_API_KEY_ID", "");
  vi.stubEnv("ALPACA_API_SECRET_KEY", "");
  ({ buildReport } = await import("./buildReport.js"));
});

describe("buildReport without provider keys", () => {
  it("returns a complete mock report", async () => {
    const r = await buildReport("aapl", 7);
    expect(r.ticker).toBe("AAPL");
    expect(r.id).toBe(7);
    expect(typeof r.snapshot.price).toBe("number");
    expect(["BUY", "HOLD", "SELL", "WATCH"]).toContain(r.overallRating);
    // Sections that can only be real with live keys stay flagged as placeholders.
    expect(r.news.isPlaceholder).toBe(true);
    expect(r.technical.isPlaceholder).toBe(true);
    expect(r.filings.isPlaceholder).toBe(true);
    // Live-only blocks are absent entirely.
    expect(r.fundamentals).toBeUndefined();
    expect(r.todaySetup).toBeUndefined();
    // Report shape is complete for the UI.
    expect(r.thesis.bull.targetPrice).toBeGreaterThan(0);
    expect(r.actionPlan.rating).toBe(r.overallRating);
    expect(r.financials.revenueHistory.length).toBeGreaterThan(0);
    // Provenance marker: a no-keys report must be tagged 'mock' so nothing treats it as real.
    expect(r.dataSource).toBe("mock");
  });

  it("mock rating is deterministic per ticker (no coin-flip verdict)", async () => {
    const [a, b] = await Promise.all([buildReport("AAPL", 1), buildReport("AAPL", 2)]);
    expect(a.overallRating).toBe(b.overallRating);
    const nvda = await buildReport("NVDA", 3);
    expect(["BUY", "HOLD", "SELL", "WATCH"]).toContain(nvda.overallRating);
  });
});
