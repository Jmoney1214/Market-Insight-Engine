import { describe, it, expect } from "vitest";
import { filingsAsOf, newsToClusters, weekdaysEndingAt } from "./backtestStore.js";
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

describe("mixed-timezone-format cutoffs (the lexicographic-comparison regression)", () => {
  const refZ = (acceptanceDateTime: string): EdgarFilingRef => ({
    cik: "0000000000",
    accessionNumber: "0000000000-26-000009",
    form: "8-K",
    filingDate: "2026-06-10",
    acceptanceDateTime,
    primaryDocument: "doc.htm",
    primaryDocDescription: null,
  });

  it("a Zulu-stamped filing from the premarket window is KEPT", () => {
    // 11:00Z = 07:00 ET, before the 08:30 ET cutoff — but "11:..." > "08:..."
    // lexicographically. Epoch comparison must keep it.
    expect(filingsAsOf([refZ("2026-06-10T11:00:00.000Z")], CUTOFF)).toHaveLength(1);
  });

  it("a Zulu-stamped filing after the cutoff is dropped", () => {
    // 13:00Z = 09:00 ET, after the cutoff.
    expect(filingsAsOf([refZ("2026-06-10T13:00:00.000Z")], CUTOFF)).toHaveLength(0);
  });

  it("Zulu premarket news survives the cutoff filter", () => {
    const zuluNews = {
      id: "z1",
      headline: "RGTI premarket headline",
      symbols: ["RGTI"],
      source: "benzinga",
      url: null,
      createdAt: "2026-06-10T11:15:00Z", // 07:15 ET — inside the window
    };
    expect(newsToClusters([zuluNews], CUTOFF)).toHaveLength(1);
  });
});

describe("weekdaysEndingAt (explicit-symbols universe)", () => {
  it("walks back from maxDate skipping weekends, newest first", () => {
    // 2026-06-10 is a Wednesday.
    expect(weekdaysEndingAt("2026-06-10", 5)).toEqual([
      "2026-06-10", // Wed
      "2026-06-09", // Tue
      "2026-06-08", // Mon
      "2026-06-05", // Fri (Sat/Sun skipped)
      "2026-06-04", // Thu
    ]);
  });

  it("starts on the previous Friday when maxDate is a weekend day", () => {
    // 2026-06-07 is a Sunday.
    expect(weekdaysEndingAt("2026-06-07", 2)).toEqual(["2026-06-05", "2026-06-04"]);
  });

  it("returns exactly the requested count", () => {
    expect(weekdaysEndingAt("2026-06-10", 30)).toHaveLength(30);
  });
});
