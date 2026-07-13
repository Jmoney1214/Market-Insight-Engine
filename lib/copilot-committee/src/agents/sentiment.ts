import type { CopilotEvent } from "@workspace/copilot-core";
import type { AgentRead, SentimentLensInput } from "../types";
import { clampConfidence } from "../guardrails";
import { fmtNum } from "../format";

/**
 * The 11th lens: renders a pre-fetched, grounded sentiment reading. The lens
 * itself is deterministic — scoring happened upstream (research layer), and
 * without an injected reading it is UNAVAILABLE, exactly like the catalyst
 * lens. Sentiment is an attention signal only, never event proof.
 */
export function sentimentAgent(
  _event: CopilotEvent,
  reading: SentimentLensInput | null | undefined,
): AgentRead {
  if (!reading) {
    return {
      agent: "sentiment",
      status: "UNAVAILABLE",
      bias: "UNKNOWN",
      confidence: 0,
      headline: "No sentiment context available.",
      supportingFactors: [],
      warnings: [
        "No grounded sentiment reading available; social/news attention is unknown.",
      ],
      riskVerdict: null,
      maxRecommendation: null,
    };
  }

  const bias =
    reading.band === "STRONG_BULLISH" || reading.band === "BULLISH"
      ? "BULLISH"
      : reading.band === "STRONG_BEARISH" || reading.band === "BEARISH"
        ? "BEARISH"
        : "NEUTRAL";

  const itemCount = reading.sources.reduce((sum, s) => sum + s.itemCount, 0);
  const breakdown = reading.sources
    .map((s) => `${s.kind}:${s.itemCount}`)
    .join(", ");

  return {
    agent: "sentiment",
    status: "OK",
    bias,
    confidence: clampConfidence(reading.confidence),
    headline: `Attention reads ${reading.band} (score ${fmtNum(reading.score)}) across ${itemCount} items.`,
    supportingFactors: [
      `Grounded sentiment ${reading.band} from ${itemCount} pre-fetched items (${breakdown}).`,
    ],
    warnings: [
      "Sentiment is an attention signal only — it is never proof an event occurred.",
    ],
    riskVerdict: null,
    maxRecommendation: null,
  };
}
