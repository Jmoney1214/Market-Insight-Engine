import { describe, it, expect } from "vitest";
import {
  PRIMARY_EDGE_HYPOTHESES,
  ENTRY_REFINEMENT_FEATURES,
  STRATEGY_REGISTRY,
  getStrategy,
  isPrimaryEdge,
  isEntryRefinement,
  isPromotable,
} from "./strategyLab";

describe("strategy lab registry", () => {
  it("ships the seven seed primary-edge hypotheses, all promotable", () => {
    expect(PRIMARY_EDGE_HYPOTHESES).toHaveLength(7);
    for (const s of PRIMARY_EDGE_HYPOTHESES) {
      expect(s.category).toBe("primary_edge");
      expect(s.promotable).toBe(true);
      expect(s.minimumSampleCount).toBeGreaterThan(0);
    }
    const names = PRIMARY_EDGE_HYPOTHESES.map((s) => s.hypothesisName);
    expect(names).toContain("OPENING_RANGE_BREAKOUT");
    expect(names).toContain("OPENING_RANGE_FAILURE");
    expect(names).toContain("POST_EARNINGS_DRIFT");
    expect(names).toContain("VOLATILITY_COMPRESSION_BREAKOUT");
  });

  it("classifies entry-refinement folklore as non-promotable context", () => {
    expect(ENTRY_REFINEMENT_FEATURES.length).toBeGreaterThan(0);
    for (const f of ENTRY_REFINEMENT_FEATURES) {
      expect(f.category).toBe("entry_refinement");
      expect(f.promotable).toBe(false);
      expect(f.note).toBeTruthy();
    }
    const names = ENTRY_REFINEMENT_FEATURES.map((f) => f.hypothesisName);
    // The popular "smart money" / ICT folklore must be non-promotable.
    for (const folklore of ["FVG", "BOS", "CHOCH", "liquidity_sweep"]) {
      expect(names).toContain(folklore);
      expect(isPromotable(folklore)).toBe(false);
      expect(isEntryRefinement(folklore)).toBe(true);
      expect(isPrimaryEdge(folklore)).toBe(false);
    }
  });

  it("STRATEGY_REGISTRY is the union and lookup works", () => {
    expect(STRATEGY_REGISTRY).toHaveLength(
      PRIMARY_EDGE_HYPOTHESES.length + ENTRY_REFINEMENT_FEATURES.length,
    );
    expect(getStrategy("OPENING_RANGE_BREAKOUT")?.promotable).toBe(true);
    expect(getStrategy("FVG")?.promotable).toBe(false);
    expect(getStrategy("DEFINITELY_NOT_A_STRATEGY")).toBeUndefined();
    expect(isPromotable("DEFINITELY_NOT_A_STRATEGY")).toBe(false);
  });
});
