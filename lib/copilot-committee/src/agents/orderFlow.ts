import type { CopilotEvent } from "@workspace/copilot-core";
import type { Bias } from "../vocab";
import type { AgentRead } from "../types";
import { clampConfidence } from "../guardrails";
import { fmtNum } from "../format";

/**
 * Reads the signed-volume summary computed from REAL executed trades
 * (`event.orderFlow`, tick rule over the live SIP tape). When no trades were
 * supplied — replay, fixtures, or a tape outage — the agent stays honestly
 * UNAVAILABLE: per the safety rules it never infers tape behaviour from price
 * alone and never invents order-flow data. Tick-rule flow without L2 depth is
 * a coarse read, so confidence is capped low.
 */
export function orderFlowAgent(event: CopilotEvent): AgentRead {
  const f = event.orderFlow;

  if (!f) {
    return {
      agent: "order_flow",
      status: "UNAVAILABLE",
      bias: "UNKNOWN",
      confidence: 0,
      headline: "Order-flow data unavailable.",
      supportingFactors: [],
      warnings: ["Order-flow data unavailable; no tape inference made."],
      riskVerdict: null,
      maxRecommendation: null,
    };
  }

  const bias: Bias =
    f.pressure === "BUYING"
      ? "BULLISH"
      : f.pressure === "SELLING"
        ? "BEARISH"
        : "NEUTRAL";

  const pct = Math.round(f.buyRatio * 100);
  const headline =
    f.pressure === "BUYING"
      ? "Tape shows net buying pressure."
      : f.pressure === "SELLING"
        ? "Tape shows net selling pressure."
        : "Tape is two-sided; no dominant pressure.";

  const supportingFactors = [
    `${pct}% of classified volume buyer-initiated over ${f.tradeCount} trades (delta ${fmtNum(f.delta)}).`,
  ];
  const warnings = [
    "Signed volume via tick rule from SIP trades; no level-2 depth.",
  ];

  // Coarse tape read: scales with sample size, hard-capped at 0.6.
  const confidence = Math.min(0.6, 0.2 + f.tradeCount / 2000);

  return {
    agent: "order_flow",
    status: "OK",
    bias,
    confidence: clampConfidence(confidence),
    headline,
    supportingFactors,
    warnings,
    riskVerdict: null,
    maxRecommendation: null,
  };
}
