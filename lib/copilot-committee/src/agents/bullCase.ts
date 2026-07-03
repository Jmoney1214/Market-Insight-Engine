import type { CopilotEvent } from "@workspace/copilot-core";
import type { AgentRead } from "../types";
import { clampConfidence } from "../guardrails";
import { fmtNum, uniq } from "../format";

/**
 * Builds the strongest bullish interpretation from structured subreads only.
 * Must cite only factors already present and must include weaknesses.
 */
export function bullCaseAgent(event: CopilotEvent, subReads: AgentRead[]): AgentRead {
  const supportingFactors: string[] = [];
  const weaknesses: string[] = [];

  for (const r of subReads) {
    if (r.bias === "BULLISH") supportingFactors.push(...r.supportingFactors);
    weaknesses.push(...r.warnings);
  }

  if (event.riskReward.direction === "LONG" && event.riskReward.ratio != null) {
    supportingFactors.push(
      `Long structure with ~${fmtNum(event.riskReward.ratio)}:1 reward/risk (research preview).`,
    );
  }

  if (event.l5Blocked) {
    weaknesses.push("A hard safety block is active; the bull case cannot be acted on.");
  }
  if (supportingFactors.length === 0) {
    supportingFactors.push("No structured bullish factors are currently present.");
  }

  const factors = uniq(supportingFactors);
  const weak = uniq(weaknesses);
  const confidence = clampConfidence(0.15 * factors.length - 0.05 * weak.length);

  return {
    agent: "bull_case",
    status: "OK",
    bias: "BULLISH",
    confidence,
    headline: "Strongest evidence-based bullish interpretation.",
    supportingFactors: factors,
    warnings: weak,
    riskVerdict: null,
    maxRecommendation: null,
  };
}
