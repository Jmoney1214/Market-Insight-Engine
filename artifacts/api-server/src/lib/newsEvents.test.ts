import { describe, it, expect } from "vitest";
import { clusterKey, clusterMarketNews } from "./newsEvents.js";
import type { MarketNewsItem } from "./providers/alpaca.js";

const item = (over: Partial<MarketNewsItem>): MarketNewsItem => ({
  id: "1",
  headline: "RGTI wins $50M government contract",
  symbols: ["RGTI"],
  source: "benzinga",
  url: "https://example.com/a",
  createdAt: "2026-07-13T12:00:00Z",
  ...over,
});

describe("clusterKey", () => {
  it("is stable across punctuation, case, and spacing (syndication lineage)", () => {
    const a = clusterKey("RGTI wins $50M government contract");
    const b = clusterKey("  rgti WINS  $50m GOVERNMENT contract!! ");
    expect(a).toBe(b);
  });

  it("differs for materially different headlines", () => {
    expect(clusterKey("RGTI wins contract")).not.toBe(clusterKey("RGTI loses contract"));
  });
});

describe("clusterMarketNews", () => {
  const NOW = "2026-07-13T13:00:00Z";

  it("dedupes syndicated copies within a batch to one event", () => {
    const out = clusterMarketNews(
      [item({ id: "1", source: "benzinga" }), item({ id: "2", source: "reuters", url: "https://example.com/b" })],
      new Map(),
      NOW,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.isRepeat).toBe(false);
    expect(out[0]!.firstSeen).toBe(NOW);
  });

  it("flags known clusters as repeats and PRESERVES the original first-seen", () => {
    const key = clusterKey(item({}).headline);
    const known = new Map([[key, "2026-07-10T08:00:00Z"]]);
    const out = clusterMarketNews([item({})], known, NOW);
    expect(out[0]!.isRepeat).toBe(true);
    expect(out[0]!.firstSeen).toBe("2026-07-10T08:00:00Z"); // point-in-time truth kept
  });

  it("filters non-plain tickers and drops empty headlines", () => {
    const out = clusterMarketNews(
      [item({ symbols: ["RGTI", "BRK.B", "TOOLONGX"] }), item({ headline: "" })],
      new Map(),
      NOW,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.symbols).toEqual(["RGTI"]);
  });
});
