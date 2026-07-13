import { describe, expect, it } from "vitest";
import {
  serializePersistedReport,
  serializeReportSummary,
} from "./reportProvenance.js";

const generatedAt = new Date("2026-07-12T12:00:00.000Z");

describe("persisted report provenance", () => {
  it("fails closed on a legacy mock report", () => {
    expect(serializePersistedReport({
      id: 1,
      source: "mock",
      generatedAt,
      reportData: { ticker: "AAPL", overallRating: "BUY" },
    })).toEqual({
      ok: false,
      status: 410,
      code: "UNTRUSTED_LEGACY_REPORT",
    });
  });

  it("preserves authoritative DB provenance on a non-mock report", () => {
    expect(serializePersistedReport({
      id: 2,
      source: "live",
      generatedAt,
      reportData: { ticker: "AAPL", source: "stale-embedded-value" },
    })).toEqual({
      ok: true,
      value: {
        ticker: "AAPL",
        source: "live",
        id: 2,
        generatedAt: "2026-07-12T12:00:00.000Z",
      },
    });
  });

  it("omits legacy mock rows from report summaries", () => {
    expect(serializeReportSummary({ id: 1, source: "mock", generatedAt })).toBeNull();
    expect(serializeReportSummary({ id: 2, source: "partial", generatedAt })).toEqual({
      id: 2,
      source: "partial",
      generatedAt: "2026-07-12T12:00:00.000Z",
    });
  });
});
