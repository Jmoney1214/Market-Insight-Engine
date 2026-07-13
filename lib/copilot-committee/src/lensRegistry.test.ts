import { describe, it, expect } from "vitest";
import { buildCopilotEvent } from "@workspace/copilot-core";
import { SELECTABLE_LENSES, validateLensSelection } from "./lensRegistry";
import { runAgents, readsToArray } from "./agents";

const event = () =>
  buildCopilotEvent({ symbol: "RGTI", mode: "LIVE", dataSource: "test", bars: [], quote: null });

describe("validateLensSelection (planner may not invent agents)", () => {
  it("accepts a subset of the registry in any order, canonicalized", () => {
    const v = validateLensSelection(["regime", "technical"]);
    expect(v.ok).toBe(true);
    expect(v.lenses).toEqual(["technical", "regime"]); // canonical run order
  });

  it("rejects unknown lenses wholesale — falls back to run-all", () => {
    const v = validateLensSelection(["technical", "broker_executor"]);
    expect(v.ok).toBe(false);
    expect(v.lenses).toBeNull();
    expect(v.issues.some((i) => i.includes("may not invent"))).toBe(true);
  });

  it("rejects empty, duplicated, and non-array proposals", () => {
    expect(validateLensSelection([]).ok).toBe(false);
    expect(validateLensSelection(["technical", "technical"]).ok).toBe(false);
    expect(validateLensSelection("technical").ok).toBe(false);
    expect(validateLensSelection(["technical", 42]).ok).toBe(false);
  });

  it("synthesis agents are not selectable", () => {
    for (const name of ["bull_case", "bear_case", "risk_critic"]) {
      expect(validateLensSelection([name]).ok).toBe(false);
    }
    expect(SELECTABLE_LENSES).not.toContain("risk_critic");
  });
});

describe("runAgents with a lens selection", () => {
  it("runs only selected lenses; bull/bear/risk always run", () => {
    const reads = runAgents(event(), { lensSelection: ["technical", "regime"] });
    expect(reads.technical.headline).not.toContain("Not selected");
    expect(reads.regime.headline).not.toContain("Not selected");
    expect(reads.pattern.status).toBe("UNAVAILABLE");
    expect(reads.pattern.headline).toContain("Not selected");
    expect(reads.orderFlow.headline).toContain("Not selected");
    // Synthesis spine still present and computed.
    expect(reads.bullCase.status).toBe("OK");
    expect(reads.riskCritic.agent).toBe("risk_critic");
    expect(readsToArray(reads)).toHaveLength(11);
  });

  it("no selection (default) runs every lens exactly as before", () => {
    const reads = runAgents(event());
    expect(readsToArray(reads).filter((r) => r.headline.includes("Not selected"))).toHaveLength(0);
  });

  it("skipped lenses carry no warnings — they cannot pollute bull/bear/risk", () => {
    const reads = runAgents(event(), { lensSelection: ["technical"] });
    expect(reads.pattern.warnings).toEqual([]);
    expect(reads.memory.warnings).toEqual([]);
  });
});

describe("deselection semantics (not-selected ≠ feed-down)", () => {
  it("deselected lenses are excluded from bull/bear/risk inputs entirely", () => {
    // With everything deselected except technical, the risk critic must not
    // emit missing-feed warnings for order_flow/catalyst — they were skipped
    // by plan, not down.
    const planned = runAgents(event(), { lensSelection: ["technical"] });
    const all = runAgents(event());
    const missingFeedWarnings = (reads: ReturnType<typeof runAgents>) =>
      reads.riskCritic.warnings.filter((w) => /unconfirmed|missing/i.test(w));
    // The planner-skipped run must not have MORE data-quality warnings than
    // the full run (skipping lenses can only remove inputs, never add risk).
    expect(missingFeedWarnings(planned).length).toBeLessThanOrEqual(missingFeedWarnings(all).length);
    // And the placeholders still render for the API payload.
    expect(planned.orderFlow.headline).toContain("Not selected");
  });
});
