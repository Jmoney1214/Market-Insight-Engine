import type { CopilotEvent } from "@workspace/copilot-core";
import type { Bias } from "../vocab";
import type { AgentRead } from "../types";
import { clampConfidence } from "../guardrails";
import { fmtNum } from "../format";

/**
 * No explicit regime classification exists in the event yet, so this agent is
 * honestly DEGRADED: it infers a coarse backdrop from volatility/volume proxies
 * only and never invents a regime label.
 */
export function regimeAgent(event: CopilotEvent): AgentRead {
  const s = event.snapshot;
  const supportingFactors: string[] = [];
  const warnings: string[] = [
    "No explicit regime classification in the event; inferred from volatility/volume proxies only.",
  ];

  let headline = "Regime proxy is inconclusive.";
  const bias: Bias = "NEUTRAL";

  if (s.rvol != null) {
    if (s.rvol >= 1.5 && s.volumeExpansion === true) {
      headline = "Volatility/volume proxy suggests a trend-friendly backdrop.";
      supportingFactors.push(`Relative volume ${fmtNum(s.rvol)}x with volume expansion.`);
    } else if (s.rvol < 1) {
      headline = "Low-participation proxy suggests a chop / mean-reversion backdrop.";
      warnings.push("Low relative volume; trend continuation is less reliable.");
    }
  }

  return {
    agent: "regime",
    status: "DEGRADED",
    bias,
    confidence: clampConfidence(0.2),
    headline,
    supportingFactors,
    warnings,
    riskVerdict: null,
    maxRecommendation: null,
  };
}
