import { describe, it, expect } from "vitest";
import { filingsAsOf, newsToClusters } from "./backtestStore.js";
import type { EdgarFilingRef } from "@workspace/research-adapters";
import type { MarketNewsItem } from "./providers/alpaca.js";

const CUTOFF = "2026-06-10T08:30:00-04:00";

describe("filingsAsOf (evidence cutoff)", () => {
  const ref = (acceptanceDateTime: string | null): EdgarFilingRef => ({
    cik: "0000000000",
    accessionNumber: "0000000000-26-000001",
    form: "8-K",
    filingDate: "2026-06-09",
    acceptanceDateTime,
    primaryDocument: "doc.htm",
    primaryDocDescription: null,
  });

  it("keeps only filings accepted at or before the cutoff", () => {
    const refs = [
      ref("2026-06-09T17:01:00-04:00"), // day before → kept
      ref("2026-06-10T08:29:59-04:00"), // just before → kept
      ref("2026-06-10T09:00:00-04:00"), // after the cutoff → LEAKAGE, dropped
      ref(null), // unknown acceptance time → dropped (never assume)
    ];
    expect(filingsAsOf(refs, CUTOFF)).toHaveLength(2);
  });
});

describe("newsToClusters (evidence cutoff + dedupe)", () => {
  const item = (createdAt: string, headline = "RGTI wins contract"): MarketNewsItem => ({
    id: "1",
    headline,
    symbols: ["RGTI"],
    source: "benzinga",
    url: null,
    createdAt,
  });

  it("drops anything published after the cutoff", () => {
    const clusters = newsToClusters(
      [item("2026-06-10T07:00:00-04:00"), item("2026-06-10T09:15:00-04:00", "future news")],
      CUTOFF,
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.headline).toBe("RGTI wins contract");
  });

  it("dedupes syndicated copies to one cluster with original timestamps", () => {
    const clusters = newsToClusters(
      [item("2026-06-10T07:00:00-04:00"), item("2026-06-10T07:05:00-04:00", "RGTI  WINS contract!!")],
      CUTOFF,
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.firstSeen).toBe("2026-06-10T07:00:00-04:00");
  });

  it("empty headlines and empty input yield no clusters", () => {
    expect(newsToClusters([item("2026-06-10T07:00:00-04:00", "")], CUTOFF)).toEqual([]);
    expect(newsToClusters([], CUTOFF)).toEqual([]);
  });
});
