import { describe, it, expect } from "vitest";
import { buildReport } from "./buildReport.js";

// With no provider keys in the environment, buildReport must return the full
// mock report (graceful no-keys fallback) with placeholder flags intact.

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
  });
});
