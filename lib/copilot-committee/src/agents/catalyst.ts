import type { CopilotEvent } from "@workspace/copilot-core";
import type { AgentRead } from "../types";

/**
 * The event carries no catalyst / news context, so this agent is UNAVAILABLE.
 * It never invents headlines, filings, or analyst actions, and flags missing
 * catalyst context as a risk for setups that would depend on it.
 */
export function catalystAgent(_event: CopilotEvent): AgentRead {
  return {
    agent: "catalyst",
    status: "UNAVAILABLE",
    bias: "UNKNOWN",
    confidence: 0,
    headline: "No catalyst context available.",
    supportingFactors: [],
    warnings: [
      "No catalyst/news context available; treat any unconfirmed catalyst as risk.",
    ],
    riskVerdict: null,
    maxRecommendation: null,
  };
}
