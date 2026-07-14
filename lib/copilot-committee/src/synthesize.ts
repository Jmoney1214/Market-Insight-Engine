// Deterministic final synthesizer. Combines all subreads into one dashboard-safe
// read following the spec priority order. It NEVER overrides the deterministic
// alert level or L5 block, always obeys the risk critic's ceiling, and only ever
// emits an approved recommendation.

import { isBearishTrigger, type CopilotEvent } from "@workspace/copilot-core";
import type { Recommendation } from "./vocab";
import type { CommitteeReads, DashboardRead } from "./types";
import { applyRiskCeiling, clampConfidence, enforceHardBlock, isHardBlocked } from "./guardrails";
import { fmtNum, uniq } from "./format";

type Direction = "LONG";

const DEFENSIVE: ReadonlySet<Recommendation> = new Set<Recommendation>([
  "AVOID",
  "WAIT",
  "DO_NOT_ADD",
  "EXIT_WARNING",
  "THESIS_INVALIDATED",
  "THESIS_WEAKENING",
]);

const PHRASE: Record<Recommendation, string> = {
  WATCH: "on watch",
  WAIT: "wait for better conditions",
  AVOID: "avoid — no setup",
  POSSIBLE_LONG_ZONE: "possible long research zone",
  THESIS_VALID: "thesis valid",
  THESIS_WEAKENING: "thesis weakening",
  TRAIL_STOP: "consider trailing stop",
  TAKE_PARTIALS: "consider partials",
  EXIT_WARNING: "thesis under pressure",
  THESIS_INVALIDATED: "thesis invalidated",
  DO_NOT_ADD: "do not add",
};

// LONG-ONLY (invert bearish to buy): any directional structural read — bullish
// OR bearish — resolves to a LONG. A bearish read is treated as an inverted
// long entry, never a short. Null only when the read is purely neutral.
function inferDirection(event: CopilotEvent, reads: CommitteeReads): Direction | null {
  if (event.riskReward.direction) return event.riskReward.direction;
  const considered = [reads.technical, reads.pattern];
  const directional = considered.some((r) => r.bias === "BULLISH" || r.bias === "BEARISH");
  return directional ? "LONG" : null;
}

function chooseRecommendation(
  event: CopilotEvent,
  reads: CommitteeReads,
  direction: Direction | null,
): Recommendation {
  const flat = event.position.status === "FLAT";

  if (isHardBlocked(event)) {
    return flat
      ? "AVOID"
      : event.position.thesisStatus === "INVALIDATED"
        ? "THESIS_INVALIDATED"
        : "EXIT_WARNING";
  }

  if (!flat) {
    switch (event.position.thesisStatus) {
      case "INVALIDATED":
        return "THESIS_INVALIDATED";
      case "WEAKENING":
        return "THESIS_WEAKENING";
      case "UNKNOWN":
        return "DO_NOT_ADD";
      default: {
        const ur = event.position.unrealizedR;
        if (ur != null && ur >= 2) return "TAKE_PARTIALS";
        if (ur != null && ur >= 1) return "TRAIL_STOP";
        return "THESIS_VALID";
      }
    }
  }

  const gates = Object.values(event.gates);
  if (gates.some((g) => g.status === "BLOCK")) return "AVOID";
  const anyWarn = gates.some((g) => g.status === "WARN");
  const cred = event.triggerStack.credibility;
  const primary = event.triggerStack.category === "primary_edge";

  if (direction && primary && cred >= 0.7 && !anyWarn) {
    return "POSSIBLE_LONG_ZONE"; // long-only: the only actionable research zone
  }
  if (cred >= 0.5) return "WATCH";
  return "WAIT";
}

function buildConfidence(
  event: CopilotEvent,
  reads: CommitteeReads,
): number {
  if (isHardBlocked(event)) return 0.85;
  const contributors = [reads.technical, reads.pattern, reads.position].filter(
    (r) => r.status === "OK",
  );
  const avg = contributors.length
    ? contributors.reduce((acc, r) => acc + r.confidence, 0) / contributors.length
    : 0.3;
  return clampConfidence(reads.riskCritic.riskVerdict === "WARN" ? avg * 0.75 : avg);
}

function buildPositionGuidance(event: CopilotEvent, rec: Recommendation): string[] {
  if (event.position.status === "IN_POSITION") {
    switch (rec) {
      case "THESIS_VALID":
        return ["Thesis intact; manage with your predefined stop."];
      case "TRAIL_STOP":
        return ["Consider trailing your stop to protect open profit."];
      case "TAKE_PARTIALS":
        return ["Consider scaling out partial size to lock in progress."];
      case "THESIS_WEAKENING":
        return ["Thesis weakening; do not add and tighten risk."];
      case "EXIT_WARNING":
        return ["Thesis is under pressure; review your risk plan."];
      case "THESIS_INVALIDATED":
        return ["Thesis invalidated; reassess the position against your plan."];
      case "DO_NOT_ADD":
        return ["Do not add to the position; manage existing risk."];
      default:
        return ["Manage existing risk against your predefined plan."];
    }
  }

  switch (rec) {
    case "POSSIBLE_LONG_ZONE":
      return ["Research-only zone; wait for your own confirmation and predefined risk."];
    case "WATCH":
      return ["On watch; no setup is confirmed yet."];
    case "AVOID":
      return ["No setup; stand aside."];
    default:
      return ["Stand aside until conditions improve."];
  }
}

export function synthesize(event: CopilotEvent, reads: CommitteeReads): DashboardRead {
  const direction = inferDirection(event, reads);

  let recommendation = chooseRecommendation(event, reads, direction);
  recommendation = applyRiskCeiling(recommendation, reads.riskCritic.maxRecommendation);
  recommendation = enforceHardBlock(recommendation, event);

  const confidence = buildConfidence(event, reads);
  const defensive = DEFENSIVE.has(recommendation);

  let whatSupports: string[];
  let whatArguesAgainst: string[];
  // An INVERTED long is one entered off a bearish structural trigger. For it,
  // the bearish evidence IS the reason for the (inverted) entry, so it must
  // read as support — not as an argument against the trade the operator is in.
  const inverted =
    !defensive && event.triggerStack.detectedTriggers.some(isBearishTrigger);

  if (defensive) {
    whatSupports = uniq([
      ...reads.riskCritic.supportingFactors,
      ...reads.bearCase.supportingFactors,
    ]);
    whatArguesAgainst = uniq(reads.bullCase.supportingFactors);
  } else if (inverted) {
    // The breakdown triggers are the rationale for the inverted long; the
    // bullish case (weak here by construction) is what argues against it.
    whatSupports = uniq(reads.bearCase.supportingFactors);
    whatArguesAgainst = uniq(reads.bullCase.supportingFactors);
  } else {
    // A normal (bullish-structured) long: bull case supports, bear case warns.
    whatSupports = uniq(reads.bullCase.supportingFactors);
    whatArguesAgainst = uniq(reads.bearCase.supportingFactors);
  }

  const whatConfirms = uniq([
    ...event.triggerStack.detectedTriggers.map((t) => `Detected trigger: ${t}.`),
    ...Object.entries(event.gates)
      .filter(([, g]) => g.status === "PASS")
      .map(([name]) => `${name} gate passing.`),
  ]);

  const whatInvalidates = uniq([
    ...event.hardBlocks.map((b) => `Hard block: ${b}.`),
    ...(event.riskReward.invalidation != null
      ? [`Structure invalidates near ${fmtNum(event.riskReward.invalidation)}.`]
      : []),
    ...Object.entries(event.gates)
      .filter(([, g]) => g.status !== "PASS")
      .map(([name, g]) => `${name} gate ${g.status}.`),
    "Setup is void if gates flip to BLOCK or stack credibility decays.",
  ]);

  const riskNotes = uniq([
    ...reads.riskCritic.supportingFactors,
    ...reads.riskCritic.warnings,
    "Research/helper output only — not an order, signal, or instruction to transact.",
  ]);

  const context = isHardBlocked(event)
    ? "hard safety block active"
    : `credibility ${fmtNum(event.triggerStack.credibility)}`;
  const oneSentenceRead = `${event.symbol} (${event.alertLevel ?? "n/a"}): ${PHRASE[recommendation]}; ${context}.`;

  return {
    oneSentenceRead,
    recommendation,
    confidence,
    whatSupports,
    whatArguesAgainst,
    whatConfirms,
    whatInvalidates,
    positionGuidance: buildPositionGuidance(event, recommendation),
    riskNotes,
  };
}
