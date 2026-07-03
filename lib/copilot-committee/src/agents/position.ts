import type { CopilotEvent } from "@workspace/copilot-core";
import type { Bias } from "../vocab";
import type { AgentRead } from "../types";
import { clampConfidence } from "../guardrails";
import { fmtSigned } from "../format";

/**
 * Reads the manual position context. Uses position-safe language only — it never
 * tells the user to enter or exit, only describes thesis state and management.
 */
export function positionAgent(event: CopilotEvent): AgentRead {
  const p = event.position;

  if (p.status === "FLAT") {
    return {
      agent: "position",
      status: "OK",
      bias: "NEUTRAL",
      confidence: clampConfidence(0.5),
      headline: "Flat — setup review only.",
      supportingFactors: [],
      warnings: [],
      riskVerdict: null,
      maxRecommendation: null,
    };
  }

  const supportingFactors: string[] = [];
  const warnings: string[] = [];
  const side = p.side ?? "LONG";
  const bias: Bias = side === "LONG" ? "BULLISH" : "BEARISH";

  if (p.unrealizedR != null) supportingFactors.push(`Unrealized result ${fmtSigned(p.unrealizedR)}R.`);

  switch (p.thesisStatus) {
    case "VALID":
      supportingFactors.push("Thesis appears valid based on current structure.");
      break;
    case "WEAKENING":
      warnings.push("Thesis is weakening; manage risk and do not add.");
      break;
    case "INVALIDATED":
      warnings.push("Thesis appears invalidated by current structure.");
      break;
    default:
      warnings.push("Thesis status is unknown; treat with caution.");
  }

  const confidence = clampConfidence(
    p.thesisStatus === "VALID" ? 0.6 : p.thesisStatus === "UNKNOWN" ? 0.3 : 0.5,
  );

  return {
    agent: "position",
    status: "OK",
    bias,
    confidence,
    headline: `In ${side.toLowerCase()} position — thesis ${p.thesisStatus.toLowerCase()}.`,
    supportingFactors,
    warnings,
    riskVerdict: null,
    maxRecommendation: null,
  };
}
