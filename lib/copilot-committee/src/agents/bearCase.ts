import type { CopilotEvent } from "@workspace/copilot-core";
import type { AgentRead } from "../types";
import { clampConfidence } from "../guardrails";
import { fmtNum, uniq } from "../format";

/**
 * Builds the strongest bearish / avoid interpretation from structured subreads
 * only. Must include what would invalidate the bearish case.
 */
export function bearCaseAgent(event: CopilotEvent, subReads: AgentRead[]): AgentRead {
  const avoidReasons: string[] = [];

  for (const r of subReads) {
    if (r.bias === "BEARISH") avoidReasons.push(...r.supportingFactors);
    avoidReasons.push(...r.warnings);
  }

  if (event.hardBlocks.length) {
    avoidReasons.push(`Hard block(s): ${event.hardBlocks.join(", ")}.`);
  }
  for (const [name, gate] of Object.entries(event.gates)) {
    if (gate.status !== "PASS") avoidReasons.push(`${name} gate ${gate.status}: ${gate.reason}`);
  }
  if (event.triggerStack.credibility < 0.5) {
    avoidReasons.push(`Low trigger credibility ${fmtNum(event.triggerStack.credibility)}.`);
  }
  if (avoidReasons.length === 0) {
    avoidReasons.push("No structured avoid reasons are currently present.");
  }

  const whatInvalidatesBear = [
    "Gates clearing to PASS with fresh quotes and acceptable spread.",
    "A credible primary-edge stack forming with volume confirmation.",
  ];

  const reasons = uniq(avoidReasons);
  const confidence = clampConfidence(0.15 * reasons.length);

  return {
    agent: "bear_case",
    status: "OK",
    bias: "BEARISH",
    confidence,
    headline: "Strongest evidence-based bearish / avoid interpretation.",
    supportingFactors: reasons,
    warnings: uniq(whatInvalidatesBear),
    riskVerdict: null,
    maxRecommendation: null,
  };
}
