import type { CopilotEvent } from "@workspace/copilot-core";
import type { Bias } from "../vocab";
import type { AgentRead } from "../types";
import { clampConfidence } from "../guardrails";
import { fmtNum } from "../format";

/**
 * Reports the measured, journal-derived edge for the active trigger stack from
 * `event.validation` (wired by the live routes via the scoreboard). Honest by
 * construction: UNAVAILABLE only when no sample exists yet; low sample size can
 * never raise confidence; and a measured non-positive edge must CAUTION, never
 * encourage. Bias stays NEUTRAL — memory measures edge quality, not direction.
 */
export function memoryAgent(event: CopilotEvent): AgentRead {
  const v = event.validation;
  const gateReason = event.gates.validation?.reason;
  const bias: Bias = "NEUTRAL";

  // No MEASURED (countable) sample yet → stay honestly unavailable. "unproven"
  // is assigned only when there are zero countable samples, even if sampleCount
  // > 0 from non-countable (WATCH_ONLY/INVALID) entries — so it is unmeasured.
  if (
    !v ||
    v.sampleCount <= 0 ||
    v.status === "insufficient_sample" ||
    v.status === "unproven"
  ) {
    const warnings = [
      "No historical journal/validation sample available; edge is unmeasured this phase.",
    ];
    if (gateReason) warnings.push(`Validation gate: ${gateReason}`);
    return {
      agent: "memory",
      status: "UNAVAILABLE",
      bias: "UNKNOWN",
      confidence: 0,
      headline: "No measured historical edge available.",
      supportingFactors: [],
      warnings,
      riskVerdict: null,
      maxRecommendation: null,
    };
  }

  const exp = v.expectancyR;
  const supportingFactors = [
    `Measured over ${v.sampleCount} sample${v.sampleCount === 1 ? "" : "s"}: ${v.status}` +
      (exp != null ? `, expectancy ${fmtNum(exp)}R` : "") +
      ".",
  ];
  const warnings: string[] = [];

  let headline: string;
  if (v.status === "paper_validated" && (exp == null || exp > 0)) {
    headline = "Historical edge is measured and validated for this setup.";
  } else if (v.status === "no_edge" || (exp != null && exp <= 0)) {
    headline = "Historical sample shows no positive edge for this setup.";
    warnings.push("Measured edge is non-positive; this setup must not raise conviction.");
  } else {
    headline = `Edge partially measured (${v.status}).`;
    warnings.push(`Edge not yet validated (${v.status}).`);
  }

  // Confidence scales with sample size but is capped low — memory informs, never dominates.
  const sampleConf = Math.min(0.5, v.sampleCount / 100);

  return {
    agent: "memory",
    status: "OK",
    bias,
    confidence: clampConfidence(sampleConf),
    headline,
    supportingFactors,
    warnings,
    riskVerdict: null,
    maxRecommendation: null,
  };
}
