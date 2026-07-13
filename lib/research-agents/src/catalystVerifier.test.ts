import { describe, it, expect } from "vitest";
import { sourceDocFixture } from "@workspace/research-contracts";
import {
  computeChecks,
  decideVerificationStatus,
  verifyCatalyst,
  type CatalystEvidence,
  type CatalystNarrator,
} from "./catalystVerifier";

const NOW = "2026-07-13T09:15:00-04:00";
const EXP = "2026-07-13T16:00:00-04:00";

const primaryDoc = sourceDocFixture(); // PRIMARY_REGULATOR, symbols: [RGTI]

const cluster = {
  clusterKey: "abc123",
  headline: "RGTI wins $50M government contract",
  isRepeat: false,
  firstSeen: NOW,
  publishedAt: NOW,
};

const evidence: CatalystEvidence = { documents: [primaryDoc], newsClusters: [cluster] };

describe("decideVerificationStatus (deterministic decision table)", () => {
  it("CONFIRMED needs primary source + entity match + not stale", () => {
    const checks = computeChecks("RGTI", evidence);
    expect(decideVerificationStatus(checks)).toBe("CONFIRMED");
  });

  it("wrong entity → UNSUPPORTED, no matter the sources", () => {
    const checks = computeChecks("TSLA", evidence);
    expect(decideVerificationStatus(checks)).toBe("UNSUPPORTED");
  });

  it("all clusters are repeats → STALE", () => {
    const checks = computeChecks("RGTI", {
      documents: [primaryDoc],
      newsClusters: [{ ...cluster, isRepeat: true }],
    });
    expect(decideVerificationStatus(checks)).toBe("STALE");
  });

  it("secondary sources only → PRIMARY_SOURCE_MISSING", () => {
    const secondary = { ...primaryDoc, sourceClass: "REPUTABLE_SECONDARY" as const };
    const checks = computeChecks("RGTI", { documents: [secondary], newsClusters: [cluster] });
    expect(decideVerificationStatus(checks)).toBe("PRIMARY_SOURCE_MISSING");
  });

  it("corrections dominate → RETRACTED_OR_CORRECTED", () => {
    const checks = computeChecks("RGTI", { ...evidence, correctionSourceIds: ["src_02"] });
    expect(decideVerificationStatus(checks)).toBe("RETRACTED_OR_CORRECTED");
  });

  it("no evidence at all → UNKNOWN", () => {
    expect(decideVerificationStatus(computeChecks("RGTI", { documents: [], newsClusters: [] }))).toBe("UNKNOWN");
  });
});

describe("verifyCatalyst", () => {
  it("works without a narrator: quoted evidence, deterministic type, UNKNOWN noted", async () => {
    const record = await verifyCatalyst({
      catalystId: "cat_t1",
      symbol: "RGTI",
      evidence,
      now: NOW,
      expiresAt: EXP,
    });
    expect(record.verificationStatus).toBe("CONFIRMED");
    expect(record.eventType).toBe("SEC_FILING"); // deterministic: SEC_8_K present
    expect(record.eventDescription).toBe(cluster.headline); // quoted, not invented
    expect(record.unknownFields.some((u) => u.reasonCode === "NARRATOR_NOT_CONFIGURED")).toBe(true);
    expect(record.primarySourceIds).toEqual([primaryDoc.sourceDocumentId]);
  });

  it("narrator refines description/type but can NEVER change the status", async () => {
    const narrator: CatalystNarrator = {
      name: "fake",
      narrate: async () => ({
        eventType: "CONTRACT_AWARD",
        eventDescription: "Government contract award disclosed in an 8-K.",
      }),
    };
    const record = await verifyCatalyst({
      catalystId: "cat_t2",
      symbol: "TSLA", // entity mismatch → UNSUPPORTED regardless of narration
      evidence,
      narrator,
      now: NOW,
      expiresAt: EXP,
    });
    expect(record.eventType).toBe("CONTRACT_AWARD");
    expect(record.verificationStatus).toBe("UNSUPPORTED");
  });

  it("schema-violating narrator output degrades to the deterministic description", async () => {
    const narrator: CatalystNarrator = {
      name: "bad",
      narrate: async () => ({ eventType: "NOT_A_TYPE", eventDescription: "" }),
    };
    const record = await verifyCatalyst({
      catalystId: "cat_t3",
      symbol: "RGTI",
      evidence,
      narrator,
      now: NOW,
      expiresAt: EXP,
    });
    expect(record.eventDescription).toBe(cluster.headline);
    expect(record.unknownFields.some((u) => u.reasonCode === "NARRATOR_OUTPUT_REJECTED")).toBe(true);
  });

  it("stamps the duplicate cluster when the news is a repeat", async () => {
    const record = await verifyCatalyst({
      catalystId: "cat_t4",
      symbol: "RGTI",
      evidence: { documents: [], newsClusters: [{ ...cluster, isRepeat: true }] },
      now: NOW,
      expiresAt: EXP,
    });
    expect(record.verificationStatus).toBe("STALE");
    expect(record.duplicateClusterId).toBe("abc123");
  });
});
