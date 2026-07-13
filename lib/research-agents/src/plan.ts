/**
 * ResearchPlan — the Lead PROPOSES a plan; this deterministic validator decides
 * whether it may execute (AgenticTrading rule: only validated plans run).
 *
 * The registry below is the complete set of specialist tools the Lead may
 * invoke. A plan referencing anything else is rejected — the planner can never
 * invent an agent (DeepFund rule).
 */
import { z } from "zod/v4";

export const SPECIALIST_TOOLS = [
  "catalyst.verify",
  "catalyst.second_verify",
  "source.audit",
  "sentiment.read",
  "macro.context",
  "capital.structure",
] as const;
export type SpecialistTool = (typeof SPECIALIST_TOOLS)[number];

export const ResearchMode = z.enum(["FAST", "STANDARD", "DEEP"]);
export type ResearchMode = z.infer<typeof ResearchMode>;

export const ResearchPlanStep = z.strictObject({
  stepId: z.string().min(1).max(64),
  tool: z.enum(SPECIALIST_TOOLS),
  dependsOn: z.array(z.string().min(1)),
});
export type ResearchPlanStep = z.infer<typeof ResearchPlanStep>;

export const ResearchPlan = z.strictObject({
  planId: z.string().min(1).max(120),
  candidateId: z.string().min(1).max(120),
  researchMode: ResearchMode,
  steps: z.array(ResearchPlanStep).min(1).max(12),
});
export type ResearchPlan = z.infer<typeof ResearchPlan>;

/** Steps a validated plan must contain, per research mode. */
const REQUIRED_TOOLS: Record<ResearchMode, SpecialistTool[]> = {
  FAST: ["catalyst.verify", "source.audit"],
  STANDARD: ["catalyst.verify", "source.audit", "sentiment.read"],
  DEEP: [
    "catalyst.verify",
    "catalyst.second_verify",
    "source.audit",
    "sentiment.read",
    "macro.context",
    "capital.structure",
  ],
};

export interface PlanValidation {
  ok: boolean;
  issues: string[];
}

/**
 * Deterministic plan validation: registered tools only, unique step ids,
 * existing dependencies, acyclic graph, mode-required steps present, and the
 * second verifier only ever runs after a first verification exists.
 */
export function validateResearchPlan(input: unknown, mode: ResearchMode): PlanValidation {
  const parsed = ResearchPlan.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }
  const plan = parsed.data;
  const issues: string[] = [];

  if (plan.researchMode !== mode) {
    issues.push(`plan researchMode ${plan.researchMode} does not match requested mode ${mode}`);
  }

  const ids = new Set<string>();
  for (const step of plan.steps) {
    if (ids.has(step.stepId)) issues.push(`duplicate stepId: ${step.stepId}`);
    ids.add(step.stepId);
  }

  const byId = new Map(plan.steps.map((s) => [s.stepId, s]));
  for (const step of plan.steps) {
    for (const dep of step.dependsOn) {
      if (!byId.has(dep)) issues.push(`step ${step.stepId} depends on missing step ${dep}`);
      if (dep === step.stepId) issues.push(`step ${step.stepId} depends on itself`);
    }
  }

  // A given specialist appears at most once — re-runs are new plans, not loops.
  const toolCounts = new Map<string, number>();
  for (const step of plan.steps) {
    toolCounts.set(step.tool, (toolCounts.get(step.tool) ?? 0) + 1);
  }
  for (const [tool, count] of toolCounts) {
    if (count > 1) issues.push(`tool ${tool} appears ${count} times; at most once per plan`);
  }

  for (const required of REQUIRED_TOOLS[mode]) {
    if (!toolCounts.has(required)) issues.push(`mode ${mode} requires tool ${required}`);
  }

  const second = plan.steps.find((s) => s.tool === "catalyst.second_verify");
  if (second) {
    const first = plan.steps.find((s) => s.tool === "catalyst.verify");
    if (!first || !second.dependsOn.includes(first.stepId)) {
      issues.push("catalyst.second_verify must depend on the catalyst.verify step");
    }
  }

  if (topoOrder(plan) === null) issues.push("plan graph contains a cycle");

  return { ok: issues.length === 0, issues };
}

/** Kahn topological sort; null when the graph has a cycle. */
export function topoOrder(plan: ResearchPlan): ResearchPlanStep[] | null {
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const step of plan.steps) {
    indegree.set(step.stepId, step.dependsOn.length);
    for (const dep of step.dependsOn) {
      dependents.set(dep, [...(dependents.get(dep) ?? []), step.stepId]);
    }
  }
  const byId = new Map(plan.steps.map((s) => [s.stepId, s]));
  const queue = plan.steps.filter((s) => s.dependsOn.length === 0).map((s) => s.stepId);
  const out: ResearchPlanStep[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const step = byId.get(id);
    if (step) out.push(step);
    for (const next of dependents.get(id) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }
  return out.length === plan.steps.length ? out : null;
}

/** The deterministic fallback plan — always passes validation for its mode. */
export function defaultPlan(candidateId: string, mode: ResearchMode): ResearchPlan {
  const steps: ResearchPlanStep[] = [{ stepId: "verify", tool: "catalyst.verify", dependsOn: [] }];
  if (mode === "DEEP") {
    steps.push({ stepId: "second_verify", tool: "catalyst.second_verify", dependsOn: ["verify"] });
  }
  steps.push({ stepId: "audit", tool: "source.audit", dependsOn: ["verify"] });
  if (mode !== "FAST") {
    steps.push({ stepId: "sentiment", tool: "sentiment.read", dependsOn: [] });
  }
  if (mode === "DEEP") {
    steps.push({ stepId: "macro", tool: "macro.context", dependsOn: [] });
    steps.push({ stepId: "capital", tool: "capital.structure", dependsOn: [] });
  }
  return { planId: `plan_${candidateId}_${mode.toLowerCase()}`, candidateId, researchMode: mode, steps };
}
