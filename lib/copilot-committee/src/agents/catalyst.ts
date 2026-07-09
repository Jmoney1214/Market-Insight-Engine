import type { CopilotEvent } from "@workspace/copilot-core";
import type { AgentRead } from "../types";
import { clampConfidence } from "../guardrails";

/**
 * Reads the deterministic headline summary from `event.catalyst` (REAL FMP
 * news supplied by the live source — counts and freshness only). Honest by
 * construction: UNAVAILABLE when no news was supplied (replay/fixtures/feed
 * outage), bias always NEUTRAL — the core never infers sentiment or
 * materiality from text; that judgment belongs to humans and the
 * catalyst-scout research agent. Confidence is capped low: "news exists" is
 * context, not conviction.
 */
export function catalystAgent(event: CopilotEvent): AgentRead {
  const c = event.catalyst;

  if (!c) {
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

  const headline =
    c.fresh24h > 0
      ? `${c.fresh24h} fresh headline${c.fresh24h === 1 ? "" : "s"} in the last 24h (newest ${c.newestAgeHours}h ago).`
      : `News coverage exists but nothing fresh in 24h (newest ${c.newestAgeHours}h ago).`;

  const supportingFactors = c.items.map(
    (it) => `"${it.headline}" — ${it.source}, ${it.ageHours}h ago.`,
  );

  const warnings = [
    "Headlines only — materiality and direction are NOT inferred; verify the catalyst before leaning on it.",
  ];
  if (c.fresh24h === 0) {
    warnings.push("Stale coverage: any move today is not explained by these headlines.");
  }

  // Context, not conviction: scales with fresh coverage, hard-capped at 0.5.
  const confidence =
    c.fresh24h > 0 ? Math.min(0.5, 0.2 + c.fresh24h * 0.1) : 0.15;

  return {
    agent: "catalyst",
    status: "OK",
    bias: "NEUTRAL",
    confidence: clampConfidence(confidence),
    headline,
    supportingFactors,
    warnings,
    riskVerdict: null,
    maxRecommendation: null,
  };
}
