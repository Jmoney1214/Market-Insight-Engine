import { describe, it, expect } from "vitest";
import { extractFinancialCatalysts } from "./buildReport.js";

// P0-1 regression: a MISSING financial metric must never become a confident
// directional catalyst. The upstream placeholders (operatingMargin 0, FCF "—",
// revenueGrowthYoY 0) previously emitted fabricated bull/bear statements.
describe("extractFinancialCatalysts — placeholder-safe (P0-1)", () => {
  const bare = {
    income: null,
    ratios: null,
    fcf: null,
    debtToEquity: null,
    consensus: null,
    price: 100,
    revenueGrowthYoY: null,
    hasRealRevenueGrowth: false,
  };

  it("no source metrics → no catalysts at all (never fabricated)", () => {
    expect(extractFinancialCatalysts(bare)).toEqual({ positive: [], negative: [] });
  });

  it("unknown operating margin does NOT emit 'margin pressure'", () => {
    // Missing operatingProfitMarginTTM: the derived field would default to 0.
    const r = extractFinancialCatalysts({ ...bare, ratios: {} });
    expect(r.negative.join(" ")).not.toContain("margin");
    expect(r.positive.join(" ")).not.toContain("margin");
  });

  it("unknown FCF does NOT emit 'generates — in free cash flow'", () => {
    const r = extractFinancialCatalysts({ ...bare, fcf: undefined });
    expect([...r.positive, ...r.negative].join(" ")).not.toContain("free cash flow");
  });

  it("NEGATIVE FCF is a bearish 'burns' catalyst, never a bullish 'generates'", () => {
    const r = extractFinancialCatalysts({ ...bare, fcf: -2_500_000_000 });
    expect(r.positive.join(" ")).not.toContain("free cash flow");
    expect(r.negative.some((s) => /Burns .* free cash flow/.test(s))).toBe(true);
  });

  it("POSITIVE FCF is a bullish 'generates' catalyst", () => {
    const r = extractFinancialCatalysts({ ...bare, fcf: 3_000_000_000 });
    expect(r.positive.some((s) => /Generates .* free cash flow/.test(s))).toBe(true);
  });

  it("real healthy margin → bullish; real thin margin → bearish", () => {
    const healthy = extractFinancialCatalysts({ ...bare, ratios: { operatingProfitMarginTTM: 0.30 } });
    expect(healthy.positive.some((s) => s.includes("healthy profitability"))).toBe(true);
    const thin = extractFinancialCatalysts({ ...bare, ratios: { operatingProfitMarginTTM: 0.05 } });
    expect(thin.negative.some((s) => s.includes("margin pressure"))).toBe(true);
  });

  it("revenue growth only counts with two real income statements", () => {
    // Flag false → even a non-null number must not emit (placeholder guard).
    const placeholder = extractFinancialCatalysts({ ...bare, revenueGrowthYoY: 0, hasRealRevenueGrowth: false });
    expect([...placeholder.positive, ...placeholder.negative].join(" ")).not.toContain("Revenue");
    const real = extractFinancialCatalysts({ ...bare, revenueGrowthYoY: 12, hasRealRevenueGrowth: true });
    expect(real.positive.some((s) => s.includes("grew 12%"))).toBe(true);
  });

  it("debt-to-equity only when the real ratio is present and elevated", () => {
    const noRatio = extractFinancialCatalysts({ ...bare, debtToEquity: 2 }); // ratios null
    expect(noRatio.negative.join(" ")).not.toContain("debt-to-equity");
    const real = extractFinancialCatalysts({ ...bare, ratios: { debtToEquityRatioTTM: 2 }, debtToEquity: 2 });
    expect(real.negative.some((s) => s.includes("debt-to-equity"))).toBe(true);
  });
});
