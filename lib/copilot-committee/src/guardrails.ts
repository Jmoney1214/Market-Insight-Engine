// Safety guardrails: confidence clamping, forbidden-language scanning, the
// absolute hard-block gate, the risk ceiling, and output validators.
//
// SAFETY: enforceHardBlock is the absolute final gate. When the deterministic
// event is hard-blocked, no agent, synthesizer, or LLM output can produce
// anything other than the four allowed defensive recommendations.

import type { CopilotEvent } from "@workspace/copilot-core";
import {
  AGENT_STATUSES,
  APPROVED_RECOMMENDATIONS,
  BIASES,
  BLOCKED_ALLOWED_RECOMMENDATIONS,
  FORBIDDEN_PHRASES,
  PERMISSIVENESS,
  type Recommendation,
} from "./vocab";
import type { AgentRead, DashboardRead } from "./types";

export function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return Math.round(value * 100) / 100;
}

export function isApprovedRecommendation(value: string): value is Recommendation {
  return (APPROVED_RECOMMENDATIONS as readonly string[]).includes(value);
}

/** Forbidden phrases found in a single string (lowercased substring match). */
export function scanForbidden(text: string): string[] {
  if (typeof text !== "string" || text.length === 0) return [];
  const haystack = text.toLowerCase();
  const hits: string[] = [];
  for (const phrase of FORBIDDEN_PHRASES) {
    if (haystack.includes(phrase)) hits.push(phrase);
  }
  return hits;
}

/** Recursively scans every string in a value for forbidden phrases. */
export function scanForbiddenDeep(value: unknown): string[] {
  const hits: string[] = [];
  const visit = (v: unknown): void => {
    if (typeof v === "string") {
      hits.push(...scanForbidden(v));
    } else if (Array.isArray(v)) {
      for (const item of v) visit(item);
    } else if (v && typeof v === "object") {
      for (const item of Object.values(v)) visit(item);
    }
  };
  visit(value);
  return hits;
}

export function hasForbiddenLanguage(value: unknown): boolean {
  return scanForbiddenDeep(value).length > 0;
}

/** Numeric tokens (integers / decimals) found in a string. */
export function extractNumbers(text: string): string[] {
  if (typeof text !== "string") return [];
  return text.match(/\d+(?:\.\d+)?/g) ?? [];
}

/**
 * Numeric tokens appearing anywhere in `value` that are NOT present in the
 * `grounding` corpus. Used to reject LLM prose that invents figures (prices,
 * levels, percentages, dates) absent from the deterministic read — a core
 * "never invent data" guardrail. Conservative by design: any ungrounded figure
 * forces a fallback to the deterministic prose.
 */
export function ungroundedNumbers(value: unknown, grounding: string): string[] {
  const allowed = new Set(extractNumbers(grounding));
  const out: string[] = [];
  const visit = (v: unknown): void => {
    if (typeof v === "string") {
      for (const token of extractNumbers(v)) {
        if (!allowed.has(token)) out.push(token);
      }
    } else if (Array.isArray(v)) {
      for (const item of v) visit(item);
    } else if (v && typeof v === "object") {
      for (const item of Object.values(v)) visit(item);
    }
  };
  visit(value);
  return out;
}

/** True when the event carries a non-overridable hard block / L5. */
export function isHardBlocked(event: CopilotEvent): boolean {
  return event.l5Blocked || event.hardBlocks.length > 0;
}

/**
 * ABSOLUTE FINAL GATE. When the event is hard-blocked, the recommendation may
 * only ever be one of the four defensive recommendations. Cannot be bypassed.
 */
export function enforceHardBlock(
  recommendation: Recommendation,
  event: CopilotEvent,
): Recommendation {
  if (!isHardBlocked(event)) return recommendation;
  if (BLOCKED_ALLOWED_RECOMMENDATIONS.includes(recommendation)) return recommendation;
  if (event.position.status === "IN_POSITION") {
    return event.position.thesisStatus === "INVALIDATED"
      ? "THESIS_INVALIDATED"
      : "EXIT_WARNING";
  }
  return "AVOID";
}

/**
 * Caps a recommendation at the risk critic's ceiling on the permissiveness
 * scale. A recommendation may never be more action-forward than the ceiling.
 */
export function applyRiskCeiling(
  recommendation: Recommendation,
  ceiling: Recommendation | null,
): Recommendation {
  if (!ceiling) return recommendation;
  return PERMISSIVENESS[recommendation] > PERMISSIVENESS[ceiling]
    ? ceiling
    : recommendation;
}

export function validateAgentRead(read: AgentRead): string[] {
  const errors: string[] = [];
  if (!(AGENT_STATUSES as readonly string[]).includes(read.status)) {
    errors.push(`agent ${read.agent}: invalid status ${read.status}`);
  }
  if (!(BIASES as readonly string[]).includes(read.bias)) {
    errors.push(`agent ${read.agent}: invalid bias ${read.bias}`);
  }
  if (!Number.isFinite(read.confidence) || read.confidence < 0 || read.confidence > 1) {
    errors.push(`agent ${read.agent}: confidence out of range ${read.confidence}`);
  }
  if (read.maxRecommendation && !isApprovedRecommendation(read.maxRecommendation)) {
    errors.push(`agent ${read.agent}: invalid maxRecommendation ${read.maxRecommendation}`);
  }
  errors.push(
    ...scanForbiddenDeep([read.headline, read.supportingFactors, read.warnings]),
  );
  return errors;
}

export function validateDashboardRead(read: DashboardRead): string[] {
  const errors: string[] = [];
  if (!isApprovedRecommendation(read.recommendation)) {
    errors.push(`invalid recommendation ${read.recommendation}`);
  }
  if (!Number.isFinite(read.confidence) || read.confidence < 0 || read.confidence > 1) {
    errors.push(`confidence out of range ${read.confidence}`);
  }
  errors.push(...scanForbiddenDeep(read));
  return errors;
}
