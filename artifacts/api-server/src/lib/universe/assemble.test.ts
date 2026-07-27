import { describe, it, expect } from "vitest";
import { assembleSymbol } from "./assemble.js";
import type { AssembleInput } from "./types.js";

const now = "2026-07-18T23:00:00Z";
const screener = {
  name: "Runner Inc", price: 4.25, volume: 8_000_000, marketCap: 120_000_000,
  sector: "Healthcare", industry: "Biotech", exchange: "NASDAQ",
  isEtf: false, isFund: false, isAdr: false,
};
const asset = {
  tradable: true, status: "active", class: "us_equity", exchange: "NASDAQ",
  shortable: false, easyToBorrow: false, marginable: true, fractionable: true,
};
const base: AssembleInput = {
  symbol: "RUNR", now, screener, asset,
  float: { floatShares: 3_000_000, sharesOutstanding: 10_000_000 },
  isRecentIpo: false, ipoDate: "2020-01-01",
};

describe("assembleSymbol", () => {
  it("eligible low-float runner", () => {
    const r = assembleSymbol(base);
    expect(r.symbol).toBe("RUNR");
    expect(r.eligible).toBe(true);
    expect(r.ineligibleReason).toBeNull();
    expect(r.floatBucket).toBe("NANO");
    expect(r.lowFloat).toBe(true);
    expect(r.floatPct).toBeCloseTo(0.3, 5);
    expect(r.avgDollarVolume).toBeCloseTo(4.25 * 8_000_000, 0);
    expect(r.exchange).toBe("NASDAQ");
    expect(r.securityType).toBe("COMMON");
    expect(r.metadataIncomplete).toBe(false);
  });

  it("hard-to-borrow is retained (squeeze signal), still eligible", () => {
    const r = assembleSymbol(base); // easyToBorrow=false above
    expect(r.eligible).toBe(true);
    expect(r.easyToBorrow).toBe(false);
  });

  it("ETF is excluded NON_COMMON", () => {
    const r = assembleSymbol({ ...base, screener: { ...screener, isEtf: true } });
    expect(r.eligible).toBe(false);
    expect(r.ineligibleReason).toBe("NON_COMMON");
    expect(r.securityType).toBe("ETF");
  });

  it("not broker-tradable (no asset) is NOT_BROKER_TRADABLE", () => {
    const r = assembleSymbol({ ...base, asset: null });
    expect(r.eligible).toBe(false);
    expect(r.ineligibleReason).toBe("NOT_BROKER_TRADABLE");
  });

  it("out-of-band price excluded", () => {
    const r = assembleSymbol({ ...base, screener: { ...screener, price: 62 } });
    expect(r.eligible).toBe(false);
    expect(r.ineligibleReason).toBe("OUT_OF_BAND");
  });

  it("missing float => UNKNOWN bucket, metadataIncomplete, still eligible", () => {
    const r = assembleSymbol({ ...base, float: null });
    expect(r.floatBucket).toBe("UNKNOWN");
    expect(r.floatShares).toBeNull();
    expect(r.metadataIncomplete).toBe(true);
    expect(r.eligible).toBe(true); // float is metadata, never a gate
  });

  it("missing screener (no price) => STALE_QUOTE, metadataIncomplete", () => {
    const r = assembleSymbol({ ...base, screener: null });
    expect(r.eligible).toBe(false);
    expect(r.ineligibleReason).toBe("STALE_QUOTE");
    expect(r.metadataIncomplete).toBe(true);
  });

  it("recent IPO flag flows through", () => {
    const r = assembleSymbol({ ...base, isRecentIpo: true });
    expect(r.isRecentIpo).toBe(true);
  });
});
