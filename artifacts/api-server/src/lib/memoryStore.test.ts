import { describe, it, expect, afterEach } from "vitest";
import {
  decisionMemoryEnabled,
  episodeEligibleForMemory,
  reinforcementDecision,
  semanticPromotionFrozen,
} from "./memoryStore.js";

// Wave 0 emergency containment — pure decision helpers. No DB, no network.

describe("semanticPromotionFrozen (Wave 0: freeze SEMANTIC promotion)", () => {
  const orig = process.env["ENABLE_SEMANTIC_PROMOTION"];
  afterEach(() => {
    if (orig === undefined) delete process.env["ENABLE_SEMANTIC_PROMOTION"];
    else process.env["ENABLE_SEMANTIC_PROMOTION"] = orig;
  });

  it("is frozen by default when the flag is unset", () => {
    delete process.env["ENABLE_SEMANTIC_PROMOTION"];
    expect(semanticPromotionFrozen()).toBe(true);
  });

  it("stays frozen for any value other than exactly 'true'", () => {
    process.env["ENABLE_SEMANTIC_PROMOTION"] = "false";
    expect(semanticPromotionFrozen()).toBe(true);
    process.env["ENABLE_SEMANTIC_PROMOTION"] = "1";
    expect(semanticPromotionFrozen()).toBe(true);
  });

  it("thaws only on the exact string 'true'", () => {
    process.env["ENABLE_SEMANTIC_PROMOTION"] = "true";
    expect(semanticPromotionFrozen()).toBe(false);
  });
});

describe("reinforcementDecision (Wave 0: importance always, promote gated)", () => {
  // Defect-A guard: the freeze must NEVER stop importance reinforcement — only
  // the SEMANTIC layer flip. A frozen bad grade must still down-rank the memory.
  it("reinforces importance even while frozen (a bad grade still lowers it)", () => {
    const { importance, promote } = reinforcementDecision({
      currentImportance: 50,
      requestedDelta: -10,
      layer: "EPISODIC",
      canPromoteAllowed: true,
      frozen: true,
    });
    expect(importance).toBe(40); // reinforced despite the freeze
    expect(promote).toBe(false); // but never promoted while frozen
  });

  it("reinforces importance up when not frozen, and promotes an eligible EPISODIC row", () => {
    const { importance, promote } = reinforcementDecision({
      currentImportance: 50,
      requestedDelta: 10,
      layer: "EPISODIC",
      canPromoteAllowed: true,
      frozen: false,
    });
    expect(importance).toBe(60);
    expect(promote).toBe(true);
  });

  it("does not promote when canPromote disallows, but still reinforces importance", () => {
    const { importance, promote } = reinforcementDecision({
      currentImportance: 50,
      requestedDelta: 10,
      layer: "EPISODIC",
      canPromoteAllowed: false,
      frozen: false,
    });
    expect(importance).toBe(60);
    expect(promote).toBe(false);
  });

  it("never promotes a non-EPISODIC layer, but still reinforces its importance", () => {
    const { importance, promote } = reinforcementDecision({
      currentImportance: 50,
      requestedDelta: 10,
      layer: "PERFORMANCE",
      canPromoteAllowed: true,
      frozen: false,
    });
    expect(importance).toBe(60);
    expect(promote).toBe(false);
  });
});

describe("episodeEligibleForMemory (Wave 0: gate episodic writes)", () => {
  it("admits COMPLETE research into episodic memory", () => {
    expect(episodeEligibleForMemory("COMPLETE")).toBe(true);
  });

  it("admits PARTIAL research into episodic memory", () => {
    expect(episodeEligibleForMemory("PARTIAL")).toBe(true);
  });

  it("does NOT write BLOCKED research to memory", () => {
    expect(episodeEligibleForMemory("BLOCKED")).toBe(false);
  });

  it("does not write any unrecognized / failed outcome", () => {
    expect(episodeEligibleForMemory("FAILED")).toBe(false);
    expect(episodeEligibleForMemory("")).toBe(false);
  });
});

describe("decisionMemoryEnabled (Wave 0: suppress unvetted committee recall)", () => {
  const orig = process.env["ENABLE_DECISION_MEMORY"];
  afterEach(() => {
    if (orig === undefined) delete process.env["ENABLE_DECISION_MEMORY"];
    else process.env["ENABLE_DECISION_MEMORY"] = orig;
  });

  it("is suppressed by default when the flag is unset", () => {
    delete process.env["ENABLE_DECISION_MEMORY"];
    expect(decisionMemoryEnabled()).toBe(false);
  });

  it("stays suppressed for any value other than exactly 'true'", () => {
    process.env["ENABLE_DECISION_MEMORY"] = "false";
    expect(decisionMemoryEnabled()).toBe(false);
    process.env["ENABLE_DECISION_MEMORY"] = "1";
    expect(decisionMemoryEnabled()).toBe(false);
  });

  it("re-enables only on the exact string 'true'", () => {
    process.env["ENABLE_DECISION_MEMORY"] = "true";
    expect(decisionMemoryEnabled()).toBe(true);
  });
});
