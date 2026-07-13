import { describe, it, expect } from "vitest";
import { buildCapitalStructure, classifyLifecycle, extractSharesOutstanding } from "./dilution";

const NOW = "2026-07-13T09:15:00-04:00";

describe("classifyLifecycle (deterministic router)", () => {
  it("recent listing → RECENT_IPO, should run", () => {
    const d = classifyLifecycle({ now: NOW, listingDate: "2026-05-01T00:00:00Z", forms: [] });
    expect(d.lifecycleType).toBe("RECENT_IPO");
    expect(d.shouldRun).toBe(true);
    expect(d.reasonCodes).toContain("LISTED_WITHIN_IPO_WINDOW");
  });

  it("recent 424B prospectus → FOLLOW_ON_OFFERING", () => {
    const d = classifyLifecycle({
      now: NOW,
      listingDate: "2020-01-01T00:00:00Z",
      forms: [{ form: "424B5", acceptedAt: "2026-06-20T00:00:00Z" }],
    });
    expect(d.lifecycleType).toBe("FOLLOW_ON_OFFERING");
    expect(d.shouldRun).toBe(true);
  });

  it("recent S-3 shelf → ACTIVE_SHELF", () => {
    const d = classifyLifecycle({
      now: NOW,
      listingDate: "2019-01-01T00:00:00Z",
      forms: [{ form: "S-3ASR", acceptedAt: "2026-03-01T00:00:00Z" }],
    });
    expect(d.lifecycleType).toBe("ACTIVE_SHELF");
  });

  it("old company, no relevant filings → MATURE, no run", () => {
    const d = classifyLifecycle({
      now: NOW,
      listingDate: "2015-01-01T00:00:00Z",
      forms: [{ form: "10-K", acceptedAt: "2026-02-01T00:00:00Z" }],
    });
    expect(d.lifecycleType).toBe("MATURE");
    expect(d.shouldRun).toBe(false);
  });
});

describe("extractSharesOutstanding", () => {
  it("extracts an unambiguous cover-page figure", () => {
    const text = "As of June 30, 2026, there were 123,456,789 shares of common stock outstanding.";
    expect(extractSharesOutstanding(text)).toBe(123_456_789);
  });

  it("returns null on ambiguity or absence — never guesses", () => {
    const ambiguous =
      "There were 100,000,000 shares of common stock outstanding. Later, 200,000,000 shares of common stock were outstanding.";
    expect(extractSharesOutstanding(ambiguous)).toBeNull();
    expect(extractSharesOutstanding("No share info here.")).toBeNull();
  });
});

describe("buildCapitalStructure", () => {
  const lifecycle = classifyLifecycle({ now: NOW, listingDate: "2026-05-01T00:00:00Z", forms: [] });

  it("extracted numbers are ALWAYS labeled ESTIMATED with the method", () => {
    const cap = buildCapitalStructure({
      diligenceId: "cap_t1",
      symbol: "RGTI",
      lifecycle,
      filings: [
        {
          form: "S-1",
          accessionNumber: "0000000000-26-000001",
          acceptedAt: "2026-05-01T00:00:00Z",
          sourceDocumentId: "src_01",
          text: "There are 50,000,000 shares of common stock outstanding as of the date hereof.",
        },
      ],
      now: NOW,
    });
    expect(cap.sharesOutstanding).toEqual({
      value: 50_000_000,
      status: "ESTIMATED",
      method: "REGEX_COVER_PAGE_EXTRACTION",
      claimId: null,
    });
    // Float is never fabricated from shares outstanding.
    expect(cap.estimatedTradableFloat.status).toBe("UNKNOWN");
    expect(cap.unknownFields.some((u) => u.path === "/estimatedTradableFloat/value")).toBe(true);
  });

  it("unextractable shares → per-field UNKNOWN with reason", () => {
    const cap = buildCapitalStructure({
      diligenceId: "cap_t2",
      symbol: "RGTI",
      lifecycle,
      filings: [
        {
          form: "S-1",
          accessionNumber: "0000000000-26-000002",
          acceptedAt: null,
          sourceDocumentId: "src_02",
          text: "No cover page figures present.",
        },
      ],
      now: NOW,
    });
    expect(cap.sharesOutstanding.status).toBe("UNKNOWN");
    expect(cap.unknownFields.some((u) => u.reasonCode === "NO_UNAMBIGUOUS_COVER_PAGE_FIGURE")).toBe(true);
  });
});
