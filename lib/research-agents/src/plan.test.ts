import { describe, it, expect } from "vitest";
import { defaultPlan, topoOrder, validateResearchPlan } from "./plan";

describe("validateResearchPlan", () => {
  it("accepts the deterministic default plan for every mode", () => {
    for (const mode of ["FAST", "STANDARD", "DEEP"] as const) {
      const plan = defaultPlan("cand_01", mode);
      expect(validateResearchPlan(plan, mode)).toEqual({ ok: true, issues: [] });
    }
  });

  it("rejects unregistered tools (planner can never invent an agent)", () => {
    const plan = {
      ...defaultPlan("cand_01", "FAST"),
      steps: [{ stepId: "x", tool: "broker.execute", dependsOn: [] }],
    };
    const v = validateResearchPlan(plan, "FAST");
    expect(v.ok).toBe(false);
  });

  it("rejects cycles, missing deps, and duplicate step ids", () => {
    const base = defaultPlan("cand_01", "FAST");
    const cyclic = {
      ...base,
      steps: [
        { stepId: "verify", tool: "catalyst.verify" as const, dependsOn: ["audit"] },
        { stepId: "audit", tool: "source.audit" as const, dependsOn: ["verify"] },
      ],
    };
    expect(validateResearchPlan(cyclic, "FAST").issues).toContain("plan graph contains a cycle");

    const missing = {
      ...base,
      steps: [
        { stepId: "verify", tool: "catalyst.verify" as const, dependsOn: ["ghost"] },
        { stepId: "audit", tool: "source.audit" as const, dependsOn: [] },
      ],
    };
    expect(validateResearchPlan(missing, "FAST").ok).toBe(false);
  });

  it("requires the second verifier to depend on the first", () => {
    const plan = {
      planId: "p",
      candidateId: "cand_01",
      researchMode: "DEEP" as const,
      steps: [
        { stepId: "verify", tool: "catalyst.verify" as const, dependsOn: [] },
        { stepId: "second", tool: "catalyst.second_verify" as const, dependsOn: [] },
        { stepId: "audit", tool: "source.audit" as const, dependsOn: ["verify"] },
        { stepId: "sent", tool: "sentiment.read" as const, dependsOn: [] },
        { stepId: "macro", tool: "macro.context" as const, dependsOn: [] },
        { stepId: "cap", tool: "capital.structure" as const, dependsOn: [] },
      ],
    };
    const v = validateResearchPlan(plan, "DEEP");
    expect(v.issues).toContain("catalyst.second_verify must depend on the catalyst.verify step");
  });

  it("enforces mode-required steps (DEEP needs macro + capital structure)", () => {
    const v = validateResearchPlan(defaultPlan("cand_01", "STANDARD"), "DEEP");
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.includes("macro.context"))).toBe(true);
  });

  it("topoOrder returns dependency order", () => {
    const plan = defaultPlan("cand_01", "DEEP");
    const order = topoOrder(plan)!;
    const pos = (id: string) => order.findIndex((s) => s.stepId === id);
    expect(pos("verify")).toBeLessThan(pos("second_verify"));
    expect(pos("verify")).toBeLessThan(pos("audit"));
  });
});
