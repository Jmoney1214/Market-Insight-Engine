import type { CopilotEvent } from "@workspace/copilot-core";
import type { Bias } from "../vocab";
import type { AgentRead } from "../types";
import { clampConfidence } from "../guardrails";

/**
 * Reads the deterministic 8-state regime classification from `event.regime`
 * (computed by the core from bars + ET time-of-day — roadmap Step 4). OK only
 * when the core actually classified a state; when there are too few bars the
 * agent stays honestly DEGRADED and never invents a regime label. Confidence
 * is capped — the backdrop informs a read, it never dominates one.
 */
export function regimeAgent(event: CopilotEvent): AgentRead {
  const r = event.regime;

  if (!r || r.state === null) {
    return {
      agent: "regime",
      status: "DEGRADED",
      bias: "NEUTRAL",
      confidence: clampConfidence(0.2),
      headline: "Regime not classified — not enough session data.",
      supportingFactors: [],
      warnings: [
        "Too few session bars to classify the intraday regime; no label invented.",
      ],
      riskVerdict: null,
      maxRecommendation: null,
    };
  }

  const bias: Bias =
    r.trendBias === "LONG"
      ? "BULLISH"
      : r.trendBias === "SHORT"
        ? "BEARISH"
        : "NEUTRAL";

  const supportingFactors = [...r.factors];
  const m = r.metrics;
  if (m.driftAtr != null && m.rangeAtr != null) {
    supportingFactors.push(
      `Session drift ${m.driftAtr} ATRs inside a ${m.rangeAtr}-ATR range.`,
    );
  }

  const warnings: string[] = [];
  if (r.state === "NEWS_SPIKE") {
    warnings.push(
      "Volatility event in progress; ranges and spreads are unstable.",
    );
  }
  if (r.state === "CHOP" || r.state === "LOW_VOL_AFTERNOON") {
    warnings.push("Backdrop does not support trend continuation.");
  }

  return {
    agent: "regime",
    status: "OK",
    bias,
    // informs, never dominates: capped at 0.7 regardless of core confidence
    confidence: clampConfidence(Math.min(0.7, r.confidence)),
    headline: `Intraday regime: ${r.state.replace(/_/g, " ").toLowerCase()}.`,
    supportingFactors,
    warnings,
    riskVerdict: null,
    maxRecommendation: null,
  };
}
