import { describe, it, expect } from "vitest";
import { pickAuditFiling } from "./researchRunner.js";
import type { EdgarFilingRef } from "@workspace/research-adapters";

// P1-7 regression: a stale filing must never substantiate a CURRENT catalyst.
const ref = (over: Partial<EdgarFilingRef>): EdgarFilingRef => ({
  cik: "0000000000",
  accessionNumber: "0000000000-26-000001",
  form: "8-K",
  filingDate: "2026-07-01",
  acceptanceDateTime: "2026-07-01T08:00:00-04:00",
  primaryDocument: "doc.htm",
  primaryDocDescription: null,
  ...over,
});

const NOW = "2026-07-14T13:00:00Z";

describe("pickAuditFiling — freshness + material preference (P1-7)", () => {
  it("rejects a year-old 10-Q even though it is material", () => {
    const stale = ref({ form: "10-Q", acceptanceDateTime: "2025-07-01T08:00:00-04:00" });
    expect(pickAuditFiling([stale], NOW)).toBeNull();
  });

  it("prefers a fresh material filing over a fresh non-material one", () => {
    const form144 = ref({ form: "144", accessionNumber: "a", acceptanceDateTime: "2026-07-13T08:00:00-04:00" });
    const eightK = ref({ form: "8-K", accessionNumber: "b", acceptanceDateTime: "2026-07-10T08:00:00-04:00" });
    expect(pickAuditFiling([form144, eightK], NOW)?.accessionNumber).toBe("b");
  });

  it("falls back to the freshest fresh filing with a document when none are material", () => {
    const form4 = ref({ form: "4", accessionNumber: "c", acceptanceDateTime: "2026-07-12T08:00:00-04:00" });
    expect(pickAuditFiling([form4], NOW)?.accessionNumber).toBe("c");
  });

  it("ignores a filing with no primary document", () => {
    const noDoc = ref({ form: "8-K", primaryDocument: "", acceptanceDateTime: "2026-07-12T08:00:00-04:00" });
    expect(pickAuditFiling([noDoc], NOW)).toBeNull();
  });

  it("uses filingDate when acceptanceDateTime is null", () => {
    const stale = ref({ acceptanceDateTime: null, filingDate: "2025-01-01" });
    expect(pickAuditFiling([stale], NOW)).toBeNull();
    const fresh = ref({ acceptanceDateTime: null, filingDate: "2026-07-10" });
    expect(pickAuditFiling([fresh], NOW)).not.toBeNull();
  });

  it("honors the freshness boundary exactly (90 days)", () => {
    const justInside = ref({ acceptanceDateTime: "2026-04-16T13:00:00Z" }); // 89 days
    const justOutside = ref({ acceptanceDateTime: "2026-04-14T13:00:00Z" }); // 91 days
    expect(pickAuditFiling([justInside], NOW)).not.toBeNull();
    expect(pickAuditFiling([justOutside], NOW)).toBeNull();
  });
});
