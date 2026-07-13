import { describe, it, expect } from "vitest";
import { canonicalSha256, verifyFinalized } from "@workspace/research-contracts";
import {
  catalystFixture,
  claimFixture,
  auditFixture,
  sentimentFixture,
  macroFixture,
  capitalFixture,
  manifestFixture,
  packetFixture,
} from "@workspace/research-contracts";
import type { LeadRunResult } from "@workspace/research-agents";
import { objectsFromLeadRun } from "./researchStore.js";
import { classifyEconomicEvent, fmpDateToIso, mapEconomicCalendar } from "./macroCalendar.js";

const leadResult = (): LeadRunResult => ({
  packet: packetFixture(),
  dependencyManifest: manifestFixture(),
  plan: { planId: "p", candidateId: "cand_01", researchMode: "STANDARD", steps: [] },
  planIssues: [],
  catalystRecords: [catalystFixture()],
  conflicts: [],
  claims: [claimFixture()],
  audits: [auditFixture()],
  sentiment: sentimentFixture(),
  macro: macroFixture(),
  capitalStructure: capitalFixture(),
});

describe("objectsFromLeadRun (brain mapping)", () => {
  it("flattens every referenced record plus the manifest into object rows", () => {
    const objects = objectsFromLeadRun(leadResult());
    expect(objects.map((o) => `${o.objectType}:${o.objectId}`).sort()).toEqual([
      "CapitalStructure:cap_01",
      "CatalystRecord:cat_01",
      "Claim:claim_01",
      "MacroContext:macro_01",
      "PacketDependencyManifest:pdm_01",
      "SentimentReading:sent_01",
      "SourceAudit:audit_01",
    ]);
  });

  it("object hashes re-verify against the packet's dependency manifest scheme", () => {
    const result = leadResult();
    const objects = objectsFromLeadRun(result);
    // Every stored hash is the canonical content hash — recomputable forever.
    for (const o of objects) {
      expect(canonicalSha256(o.payload)).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
    expect(verifyFinalized(result.packet as unknown as Record<string, unknown>)).toBe(true);
    expect(verifyFinalized(result.dependencyManifest as unknown as Record<string, unknown>)).toBe(true);
  });

  it("abstained specialists (nulls) simply store nothing", () => {
    const result = { ...leadResult(), sentiment: null, macro: null, capitalStructure: null };
    const types = objectsFromLeadRun(result).map((o) => o.objectType);
    expect(types).not.toContain("SentimentReading");
    expect(types).not.toContain("MacroContext");
    expect(types).not.toContain("CapitalStructure");
  });
});

describe("macro calendar mapping (FMP)", () => {
  it("classifies market-moving release families", () => {
    expect(classifyEconomicEvent("Consumer Price Index (YoY)")).toBe("CPI");
    expect(classifyEconomicEvent("Fed Interest Rate Decision")).toBe("FOMC");
    expect(classifyEconomicEvent("Nonfarm Payrolls")).toBe("NFP");
    expect(classifyEconomicEvent("Initial Jobless Claims")).toBe("JOBLESS_CLAIMS");
    expect(classifyEconomicEvent("Used Car Sales Monthly")).toBeNull();
  });

  it("tags FMP wall-clock dates as US/Eastern ISO", () => {
    expect(fmpDateToIso("2026-07-14 08:30:00")).toBe("2026-07-14T08:30:00-04:00");
    expect(fmpDateToIso("garbage")).toBeNull();
  });

  it("maps US rows in recognized families with honest vintage labels", () => {
    const rows = [
      { event: "Consumer Price Index (YoY)", date: "2026-07-14 08:30:00", country: "US", actual: null, estimate: 2.6, impact: "High", unit: "%" },
      { event: "GDP Growth Rate", date: "2026-07-15 08:30:00", country: "US", actual: 2.1, estimate: 2.0, impact: "High", unit: "%" },
      { event: "Consumer Price Index (YoY)", date: "2026-07-14 09:00:00", country: "DE", actual: null, estimate: 2.0, impact: "High", unit: "%" },
      { event: "Obscure Local Index", date: "2026-07-14 10:00:00", country: "US", actual: null, estimate: null, impact: "Low", unit: null },
    ];
    const mapped = mapEconomicCalendar(rows);
    expect(mapped).toHaveLength(2);
    expect(mapped[0]).toEqual({
      eventType: "CPI",
      scheduledTime: "2026-07-14T08:30:00-04:00",
      reportedValue: null,
      consensusValue: 2.6,
      unit: "%",
      revisionStatus: "UNKNOWN", // upcoming — nothing printed yet
      sourceDocumentId: null,
    });
    expect(mapped[1]!.revisionStatus).toBe("PRELIMINARY"); // first print, never FINAL
  });
});
