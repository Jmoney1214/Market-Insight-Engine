// Unit tests for the pure safety guardrails: confidence clamping, the
// forbidden-language scanners, the absolute hard-block gate, the risk ceiling,
// and the read validators.

import { describe, it, expect } from "vitest";
import type { CopilotEvent } from "@workspace/copilot-core";
import {
  clampConfidence,
  isApprovedRecommendation,
  scanForbidden,
  scanForbiddenDeep,
  hasForbiddenLanguage,
  enforceHardBlock,
  applyRiskCeiling,
  validateAgentRead,
  validateDashboardRead,
} from "./guardrails";
import type { AgentRead, DashboardRead } from "./types";

type ThesisStatus = "VALID" | "WEAKENING" | "INVALIDATED" | "UNKNOWN";

function makeEvent(opts: {
  blocked: boolean;
  status?: "FLAT" | "IN_POSITION";
  thesisStatus?: ThesisStatus;
}): CopilotEvent {
  return {
    l5Blocked: opts.blocked,
    hardBlocks: opts.blocked ? ["DATA_FAILURE"] : [],
    position: {
      status: opts.status ?? "FLAT",
      thesisStatus: opts.thesisStatus ?? "VALID",
    },
  } as unknown as CopilotEvent;
}

function validAgent(overrides: Partial<AgentRead> = {}): AgentRead {
  return {
    agent: "technical",
    status: "OK",
    bias: "BULLISH",
    confidence: 0.5,
    headline: "Trend is constructive above VWAP.",
    supportingFactors: ["Price holding above the opening range."],
    warnings: [],
    riskVerdict: null,
    maxRecommendation: null,
    ...overrides,
  };
}

function validDashboard(overrides: Partial<DashboardRead> = {}): DashboardRead {
  return {
    oneSentenceRead: "On watch; credibility building.",
    recommendation: "WATCH",
    confidence: 0.4,
    whatSupports: [],
    whatArguesAgainst: [],
    whatConfirms: [],
    whatInvalidates: [],
    positionGuidance: [],
    riskNotes: ["Research/helper output only."],
    ...overrides,
  };
}

describe("clampConfidence", () => {
  it("clamps to [0,1] and handles non-finite inputs", () => {
    expect(clampConfidence(Number.NaN)).toBe(0);
    expect(clampConfidence(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampConfidence(-1)).toBe(0);
    expect(clampConfidence(2)).toBe(1);
    expect(clampConfidence(0.5)).toBe(0.5);
  });

  it("rounds to two decimal places", () => {
    expect(clampConfidence(0.126)).toBe(0.13);
    expect(clampConfidence(0.124)).toBe(0.12);
  });
});

describe("isApprovedRecommendation", () => {
  it("accepts only the approved vocabulary", () => {
    expect(isApprovedRecommendation("WATCH")).toBe(true);
    expect(isApprovedRecommendation("AVOID")).toBe(true);
    expect(isApprovedRecommendation("BUY")).toBe(false);
    expect(isApprovedRecommendation("")).toBe(false);
  });
});

describe("forbidden-language scanners", () => {
  it("scanForbidden catches execution, ordering, and false-certainty phrases", () => {
    expect(scanForbidden("Please submit_order on the open")).toContain("submit_order");
    expect(scanForbidden("We will execute the plan at the open")).toContain("execute");
    expect(scanForbidden("This is a guaranteed to the moon trade")).toEqual(
      expect.arrayContaining(["guaranteed", "to the moon"]),
    );
    expect(scanForbidden("On watch; no setup confirmed yet.")).toEqual([]);
    expect(scanForbidden("")).toEqual([]);
  });

  it("scanForbiddenDeep walks nested structures", () => {
    const value = {
      a: ["fine", "we could place_order here"],
      b: { c: "clean text", d: ["also clean"] },
    };
    expect(scanForbiddenDeep(value)).toContain("place_order");
    expect(scanForbiddenDeep({ x: "all clean" })).toEqual([]);
  });

  it("hasForbiddenLanguage reflects the deep scan", () => {
    expect(hasForbiddenLanguage({ note: "execute_trade now" })).toBe(true);
    expect(hasForbiddenLanguage({ note: "stand aside" })).toBe(false);
  });
});

describe("enforceHardBlock — absolute final gate", () => {
  it("leaves the recommendation untouched when not blocked", () => {
    const event = makeEvent({ blocked: false });
    expect(enforceHardBlock("POSSIBLE_LONG_ZONE", event)).toBe("POSSIBLE_LONG_ZONE");
  });

  it("forces AVOID when blocked and flat", () => {
    const event = makeEvent({ blocked: true, status: "FLAT" });
    expect(enforceHardBlock("POSSIBLE_LONG_ZONE", event)).toBe("AVOID");
  });

  it("forces EXIT_WARNING when blocked and in a still-valid position", () => {
    const event = makeEvent({
      blocked: true,
      status: "IN_POSITION",
      thesisStatus: "VALID",
    });
    expect(enforceHardBlock("POSSIBLE_LONG_ZONE", event)).toBe("EXIT_WARNING");
  });

  it("forces THESIS_INVALIDATED when blocked and the thesis is invalidated", () => {
    const event = makeEvent({
      blocked: true,
      status: "IN_POSITION",
      thesisStatus: "INVALIDATED",
    });
    expect(enforceHardBlock("WATCH", event)).toBe("THESIS_INVALIDATED");
  });

  it("passes through an already-defensive recommendation when blocked", () => {
    const event = makeEvent({ blocked: true, status: "FLAT" });
    expect(enforceHardBlock("DO_NOT_ADD", event)).toBe("DO_NOT_ADD");
    expect(enforceHardBlock("EXIT_WARNING", event)).toBe("EXIT_WARNING");
  });
});

describe("applyRiskCeiling", () => {
  it("returns the recommendation unchanged when there is no ceiling", () => {
    expect(applyRiskCeiling("POSSIBLE_LONG_ZONE", null)).toBe("POSSIBLE_LONG_ZONE");
  });

  it("caps a more action-forward recommendation at the ceiling", () => {
    expect(applyRiskCeiling("POSSIBLE_LONG_ZONE", "WATCH")).toBe("WATCH");
  });

  it("leaves a less action-forward recommendation alone", () => {
    expect(applyRiskCeiling("WAIT", "WATCH")).toBe("WAIT");
    expect(applyRiskCeiling("WATCH", "WATCH")).toBe("WATCH");
  });
});

describe("validateAgentRead", () => {
  it("accepts a well-formed read", () => {
    expect(validateAgentRead(validAgent())).toEqual([]);
  });

  it("flags an invalid status", () => {
    const read = validAgent({ status: "BROKEN" as AgentRead["status"] });
    expect(validateAgentRead(read).length).toBeGreaterThan(0);
  });

  it("flags an invalid bias", () => {
    const read = validAgent({ bias: "SIDEWAYS" as AgentRead["bias"] });
    expect(validateAgentRead(read).length).toBeGreaterThan(0);
  });

  it("flags out-of-range confidence", () => {
    expect(validateAgentRead(validAgent({ confidence: 2 })).length).toBeGreaterThan(0);
  });

  it("flags forbidden language in the headline", () => {
    const read = validAgent({ headline: "submit_order immediately" });
    expect(validateAgentRead(read)).toContain("submit_order");
  });
});

describe("validateDashboardRead", () => {
  it("accepts a well-formed read", () => {
    expect(validateDashboardRead(validDashboard())).toEqual([]);
  });

  it("flags an invalid recommendation", () => {
    const read = validDashboard({
      recommendation: "BUY" as DashboardRead["recommendation"],
    });
    expect(validateDashboardRead(read).length).toBeGreaterThan(0);
  });

  it("flags forbidden language in the risk notes", () => {
    const read = validDashboard({ riskNotes: ["guaranteed profit"] });
    expect(validateDashboardRead(read)).toContain("guaranteed");
  });
});
