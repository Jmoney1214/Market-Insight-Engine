import type { CopilotEvent } from "@workspace/copilot-core";
import type { AgentRead } from "../types";

/**
 * The event carries no tape / level-2 / signed-volume data, so order flow is
 * UNAVAILABLE. Per the safety rules, it never infers tape behaviour from price
 * alone and never invents order-flow data.
 */
export function orderFlowAgent(_event: CopilotEvent): AgentRead {
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
