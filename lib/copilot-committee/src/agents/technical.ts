import type { CopilotEvent } from "@workspace/copilot-core";
import type { Bias } from "../vocab";
import type { AgentRead } from "../types";
import { clampConfidence } from "../guardrails";
import { fmtNum, fmtSigned } from "../format";

/** Reads price/VWAP/volume structure from the snapshot only. */
export function technicalAgent(event: CopilotEvent): AgentRead {
  const s = event.snapshot;
  const supportingFactors: string[] = [];
  const warnings: string[] = [];

  if (s.price == null || s.vwap == null) {
    return {
      agent: "technical",
      status: "DEGRADED",
      bias: "UNKNOWN",
      confidence: 0,
      headline: "Insufficient price/VWAP data for a technical read.",
      supportingFactors,
      warnings: ["Price or VWAP unavailable; technical read degraded."],
      riskVerdict: null,
      maxRecommendation: null,
    };
  }

  let bullish = 0;
  let bearish = 0;

  if (s.price > s.vwap) {
    bullish += 1;
    supportingFactors.push(`Price ${fmtNum(s.price)} is above VWAP ${fmtNum(s.vwap)}.`);
  } else if (s.price < s.vwap) {
    bearish += 1;
    supportingFactors.push(`Price ${fmtNum(s.price)} is below VWAP ${fmtNum(s.vwap)}.`);
  }

  if (s.rvol != null) {
    if (s.rvol >= 1.5) {
      supportingFactors.push(`Relative volume ${fmtNum(s.rvol)}x shows elevated participation.`);
    } else if (s.rvol < 1) {
      warnings.push(`Relative volume ${fmtNum(s.rvol)}x is below average; weak participation.`);
    }
  }

  if (s.volumeExpansion === true) {
    supportingFactors.push("Volume expansion present on the active leg.");
  } else if (s.volumeExpansion === false) {
    warnings.push("No volume expansion; move lacks volume confirmation.");
  }

  if (s.change1d != null) supportingFactors.push(`Session change ${fmtSigned(s.change1d)}%.`);
  if (s.priceLocation) supportingFactors.push(`Price location: ${s.priceLocation}.`);

  if (event.marketQuality.spreadOk === false) {
    warnings.push("Spread is wide relative to normal; fills would be unreliable.");
  }
  if (event.marketQuality.quoteFresh === false) {
    warnings.push("Quote is stale; technical read may be outdated.");
  }

  const bias: Bias = bullish > bearish ? "BULLISH" : bearish > bullish ? "BEARISH" : "NEUTRAL";
  const directional = Math.abs(bullish - bearish);
  let confidence =
    0.3 +
    0.15 * directional +
    (s.volumeExpansion === true ? 0.15 : 0) +
    (s.rvol != null && s.rvol >= 1.5 ? 0.1 : 0);
  confidence -= 0.1 * warnings.length;

  const headline =
    bias === "NEUTRAL"
      ? "Technicals are mixed around VWAP."
      : `Technicals lean ${bias.toLowerCase()} relative to VWAP and participation.`;

  return {
    agent: "technical",
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
