import type { CopilotEvent } from "@workspace/copilot-core";
import type { AgentRead } from "../types";

/**
 * No journal/validation sample is wired into the event in this phase, so the
 * memory agent reports UNAVAILABLE rather than inventing an edge. It surfaces
 * the deterministic validation gate reason as context. Low/absent sample size
 * must never raise confidence.
 */
export function memoryAgent(event: CopilotEvent): AgentRead {
  const warnings = [
    "No historical journal/validation sample available; edge is unmeasured this phase.",
  ];
  const validation = event.gates.validation;
  if (validation && validation.reason) {
    warnings.push(`Validation gate: ${validation.reason}`);
  }

  return {
    agent: "memory",
    status: "UNAVAILABLE",
    bias: "UNKNOWN",
    confidence: 0,
    headline: "No measured historical edge available.",
    supportingFactors: [],
    warnings,
    riskVerdict: null,
    maxRecommendation: null,
  };
}
