import type { CopilotEvent } from "@workspace/copilot-core";
import type { Recommendation, RiskVerdict } from "../vocab";
import type { AgentRead } from "../types";
import { clampConfidence } from "../guardrails";
import { fmtNum, uniq } from "../format";

/**
 * Actively searches for reasons to downgrade, block, or avoid, and emits a
 * recommendation ceiling. If a hard block / blocking gate exists the verdict is
 * BLOCK. Missing order-flow / catalyst data warns but does not block by default.
 */
export function riskCriticAgent(event: CopilotEvent, subReads: AgentRead[]): AgentRead {
  const downgradeReasons: string[] = [];
  const warnings: string[] = [];
  let verdictRank = 0; // 0 = PASS, 1 = WARN, 2 = BLOCK

  const escalate = (next: RiskVerdict): void => {
    const rank = next === "BLOCK" ? 2 : next === "WARN" ? 1 : 0;
    if (rank > verdictRank) verdictRank = rank;
  };

  const flat = event.position.status === "FLAT";

  if (event.l5Blocked || event.hardBlocks.length) {
    escalate("BLOCK");
    downgradeReasons.push(`Hard block active: ${event.hardBlocks.join(", ") || "L5"}.`);
  }

  for (const [name, gate] of Object.entries(event.gates)) {
    if (gate.status === "BLOCK") {
      escalate("BLOCK");
      downgradeReasons.push(`${name} gate BLOCK: ${gate.reason}`);
    } else if (gate.status === "WARN") {
      escalate("WARN");
      warnings.push(`${name} gate WARN: ${gate.reason}`);
    }
  }

  if (event.feedQuality.verdict === "BLOCKED") {
    escalate("BLOCK");
    downgradeReasons.push("Feed quality is blocked.");
  } else if (event.feedQuality.verdict === "DEGRADED" || event.feedQuality.isStale) {
    escalate("WARN");
    warnings.push("Feed quality is degraded or stale.");
  }

  if (event.riskReward.ratio != null && event.riskReward.ratio < 1.5) {
    escalate("WARN");
    downgradeReasons.push(`Reward/risk is thin (${fmtNum(event.riskReward.ratio)}:1).`);
  }
  if (event.triggerStack.credibility < 0.5) {
    escalate("WARN");
    downgradeReasons.push("Trigger-stack credibility is low.");
  }
  if (event.triggerStack.category === "entry_refinement") {
    warnings.push("Setup rests on entry-refinement, not a measured primary edge.");
  }

  if (subReads.some((r) => r.agent === "order_flow" && r.status === "UNAVAILABLE")) {
    warnings.push("Order-flow is unconfirmed.");
  }
  if (subReads.some((r) => r.agent === "catalyst" && r.status === "UNAVAILABLE")) {
    warnings.push("Catalyst context is missing; unconfirmed catalysts are a risk.");
  }

  const verdict: RiskVerdict =
    verdictRank === 2 ? "BLOCK" : verdictRank === 1 ? "WARN" : "PASS";

  let ceiling: Recommendation;
  if (verdict === "BLOCK") {
    ceiling = flat
      ? "AVOID"
      : event.position.thesisStatus === "INVALIDATED"
        ? "THESIS_INVALIDATED"
        : "EXIT_WARNING";
  } else if (flat) {
    ceiling = verdict === "WARN" ? "WATCH" : "POSSIBLE_LONG_ZONE";
  } else if (event.position.thesisStatus === "INVALIDATED") {
    ceiling = "THESIS_INVALIDATED";
  } else if (event.position.thesisStatus === "WEAKENING" || verdict === "WARN") {
    ceiling = "THESIS_WEAKENING";
  } else {
    ceiling = "THESIS_VALID";
  }

  const headline =
    verdict === "BLOCK"
      ? "Risk critic: blocked — no actionable setup."
      : verdict === "WARN"
        ? "Risk critic: proceed only with caution."
        : "Risk critic: no disqualifying risks found.";

  const confidence = clampConfidence(verdict === "BLOCK" ? 0.9 : verdict === "WARN" ? 0.6 : 0.5);

  return {
    agent: "risk_critic",
    status: "OK",
    bias: "NEUTRAL",
    confidence,
    headline,
    supportingFactors: uniq(downgradeReasons),
    warnings: uniq(warnings),
    riskVerdict: verdict,
    maxRecommendation: ceiling,
  };
}
