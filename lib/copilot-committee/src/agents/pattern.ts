import type { CopilotEvent } from "@workspace/copilot-core";
import type { Bias } from "../vocab";
import type { AgentRead } from "../types";
import { clampConfidence } from "../guardrails";
import { fmtNum } from "../format";

/** Reads the deterministic trigger stack and structural direction only. */
export function patternAgent(event: CopilotEvent): AgentRead {
  const stack = event.triggerStack;
  const detected = stack.detectedTriggers;
  const supportingFactors: string[] = [];
  const warnings: string[] = [];

  if (detected.length === 0) {
    return {
      agent: "pattern",
      status: "DEGRADED",
      bias: "NEUTRAL",
      confidence: 0,
      headline: "No structural trigger stack detected.",
      supportingFactors,
      warnings: ["No detected triggers; structural read unavailable."],
      riskVerdict: null,
      maxRecommendation: null,
    };
  }

  supportingFactors.push(`Stack "${stack.stackName}" with triggers: ${detected.join(", ")}.`);
  supportingFactors.push(`Deterministic credibility ${fmtNum(stack.credibility)}.`);

  if (stack.category === "entry_refinement") {
    warnings.push("Stack is entry-refinement only; not a measured primary edge.");
  } else if (stack.category === null) {
    warnings.push("Stack category is unclassified.");
  }

  // LONG-ONLY (invert bearish to buy): a detected directional structure is an
  // actionable long — bullish outright, or a bearish break inverted into a long
  // entry. Either way the structural read is BULLISH for the (long) trade; a
  // stack with no direction stays NEUTRAL.
  const dir = event.riskReward.direction;
  const bias: Bias = dir === "LONG" ? "BULLISH" : "NEUTRAL";
  const confidence = clampConfidence(
    stack.credibility - (stack.category === "entry_refinement" ? 0.15 : 0),
  );

  return {
    agent: "pattern",
    status: "OK",
    bias,
    confidence,
    headline: `Structure: ${stack.stackName} (${stack.category ?? "unclassified"}).`,
    supportingFactors,
    warnings,
    riskVerdict: null,
    maxRecommendation: null,
  };
}
