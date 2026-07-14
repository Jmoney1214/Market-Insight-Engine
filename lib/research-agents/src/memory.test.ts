import { describe, it, expect } from "vitest";
import {
  LAYER_POLICIES,
  MAX_REINFORCEMENT_DELTA,
  canPromote,
  compoundScore,
  cosineSimilarity,
  estimateTokens,
  expiryFor,
  rankMemories,
  reinforceImportance,
  renderDecisionMemory,
  type MemoryItem,
} from "./memory";

const NOW = "2026-07-13T12:00:00Z";

const item = (over: Partial<MemoryItem>): MemoryItem => ({
  memoryId: "mem_1",
  layer: "EPISODIC",
  kind: "RESEARCH_EPISODE",
  symbol: "RGTI",
  content: "Research STANDARD on RGTI: COMPLETE.",
  importance: 50,
  createdAt: NOW,
  expiresAt: null,
  schemaValid: false,
  independentGradeRef: null,
  ...over,
});

describe("layer policies + expiry", () => {
  it("working memory expires; semantic and performance are permanent", () => {
    expect(expiryFor("WORKING", NOW)).toBe("2026-07-14T12:00:00.000Z");
    expect(expiryFor("SEMANTIC", NOW)).toBeNull();
    expect(expiryFor("PERFORMANCE", NOW)).toBeNull();
    expect(LAYER_POLICIES.EPISODIC.ttlHours).toBe(24 * 60);
  });
});

describe("compoundScore (FinMem)", () => {
  it("decays with age at the layer's half-life", () => {
    const fresh = compoundScore({ layer: "WORKING", ageHours: 0, importance: 50, similarity: null });
    const halfLife = compoundScore({ layer: "WORKING", ageHours: 6, importance: 50, similarity: null });
    expect(fresh).toBeCloseTo(0.5 * 1 + 0.25, 5);
    expect(halfLife).toBeCloseTo(0.5 * 0.5 + 0.25, 5);
  });

  it("similarity contributes only when present — never a fabricated 0.5", () => {
    const withSim = compoundScore({ layer: "EPISODIC", ageHours: 0, importance: 50, similarity: 0.9 });
    const noSim = compoundScore({ layer: "EPISODIC", ageHours: 0, importance: 50, similarity: null });
    expect(withSim).toBeCloseTo(0.35 + 0.15 + 0.35 * 0.9, 5);
    expect(noSim).toBeCloseTo(0.75, 5);
  });
});

describe("cosineSimilarity", () => {
  it("computes and guards degenerate inputs", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 5);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
    expect(cosineSimilarity([], [])).toBeNull();
    expect(cosineSimilarity([1], [1, 2])).toBeNull();
    expect(cosineSimilarity([0, 0], [1, 2])).toBeNull();
  });
});

describe("rankMemories", () => {
  it("expired items never rank", () => {
    const ranked = rankMemories({
      items: [item({ memoryId: "dead", layer: "WORKING", expiresAt: "2026-07-13T11:00:00Z" })],
      now: NOW,
    });
    expect(ranked).toEqual([]);
  });

  it("enforces per-layer token budgets", () => {
    const big = "x".repeat(LAYER_POLICIES.WORKING.tokenBudget * 4); // exactly the budget
    const ranked = rankMemories({
      items: [
        item({ memoryId: "a", layer: "WORKING", content: big, importance: 90 }),
        item({ memoryId: "b", layer: "WORKING", content: big, importance: 80 }), // over budget
        item({ memoryId: "c", layer: "EPISODIC", content: "small", importance: 10 }),
      ],
      now: NOW,
    });
    const ids = ranked.map((r) => r.item.memoryId);
    expect(ids).toContain("a");
    expect(ids).not.toContain("b"); // WORKING budget exhausted by "a"
    expect(ids).toContain("c"); // other layers unaffected
  });

  it("ranks by compound score with similarity boost", () => {
    const ranked = rankMemories({
      items: [
        item({ memoryId: "plain", importance: 50 }),
        item({ memoryId: "similar", importance: 50 }),
      ],
      now: NOW,
      similarities: new Map([["similar", 0.95]]),
    });
    expect(ranked[0]!.item.memoryId).toBe("similar");
  });
});

describe("reinforceImportance (bounded loop)", () => {
  it("bounds any single adjustment and clamps to [0,100]", () => {
    expect(reinforceImportance(50, 100)).toBe(50 + MAX_REINFORCEMENT_DELTA);
    expect(reinforceImportance(50, -100)).toBe(50 - MAX_REINFORCEMENT_DELTA);
    expect(reinforceImportance(95, 15)).toBe(100);
    expect(reinforceImportance(5, -15)).toBe(0);
  });
});

describe("canPromote (anti-poisoning gate)", () => {
  it("SEMANTIC requires schema validity AND an independent grade — no self-evolving truth", () => {
    expect(canPromote(item({}), "SEMANTIC").allowed).toBe(false);
    expect(canPromote(item({ schemaValid: true }), "SEMANTIC").allowed).toBe(false);
    expect(canPromote(item({ independentGradeRef: "finding_grades:7" }), "SEMANTIC").allowed).toBe(false);
    expect(
      canPromote(item({ schemaValid: true, independentGradeRef: "finding_grades:7" }), "SEMANTIC").allowed,
    ).toBe(true);
  });

  it("rejects no-op and demotion 'promotions'", () => {
    expect(canPromote(item({ layer: "SEMANTIC", schemaValid: true, independentGradeRef: "g" }), "SEMANTIC").allowed).toBe(false);
    expect(canPromote(item({}), "WORKING").allowed).toBe(false);
  });
});

describe("renderDecisionMemory", () => {
  it("renders newest-first, outcome-joined, pending when ungraded", () => {
    const lines = renderDecisionMemory([
      { when: "2026-07-10T10:00:00Z", source: "research STANDARD", verdict: "COMPLETE", outcome: "judges 90" },
      { when: "2026-07-12T10:00:00Z", source: "research DEEP", verdict: "PARTIAL", outcome: null },
    ]);
    expect(lines).toEqual([
      "2026-07-12 research DEEP: PARTIAL → outcome pending",
      "2026-07-10 research STANDARD: COMPLETE → judges 90",
    ]);
  });

  it("caps at the limit", () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({
      when: `2026-07-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      source: "research FAST",
      verdict: "COMPLETE",
      outcome: null,
    }));
    expect(renderDecisionMemory(entries, 5)).toHaveLength(5);
  });
});

describe("estimateTokens", () => {
  it("~4 chars per token, ceiling", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});
