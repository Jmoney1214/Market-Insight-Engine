// Orchestrator: runs the deterministic committee, optionally layers prose-only
// LLM enrichment, and enforces every guardrail before returning one structured
// response. Falls back to the deterministic read on ANY provider failure.
//
// SAFETY LAYERING (in order):
//   deterministic agents -> risk critic ceiling -> deterministic synthesizer
//   -> validate -> optional LLM prose enrichment -> sanitize/validate
//   -> applyRiskCeiling (in synth) -> enforceHardBlock (final absolute gate)
//   -> final forbidden-language sweep over the whole payload.

import type { CopilotEvent } from "@workspace/copilot-core";
import type {
  AgentRead,
  CommitteeProvider,
  CommitteeResult,
  CommitteeSource,
  CommitteeStatus,
  DashboardRead,
  ProviderContext,
  ProviderProse,
} from "./types";
import { runAgents, readsToArray } from "./agents";
import { synthesize } from "./synthesize";
import {
  enforceHardBlock,
  scanForbidden,
  scanForbiddenDeep,
  ungroundedNumbers,
  validateAgentRead,
  validateDashboardRead,
} from "./guardrails";
import { safetyNetRead } from "./fallback";
import { uniq } from "./format";

interface FinalizeInput {
  status: CommitteeStatus;
  source: CommitteeSource;
  provider: string;
  degraded: boolean;
  event: CopilotEvent;
  agents: AgentRead[];
  dashboardRead: DashboardRead;
  warnings: string[];
}

/** Only the three prose fields may be overridden, and only with valid content. */
function applyProse(base: DashboardRead, prose: ProviderProse): DashboardRead {
  const oneSentenceRead =
    typeof prose.oneSentenceRead === "string" && prose.oneSentenceRead.trim().length > 0
      ? prose.oneSentenceRead.trim()
      : base.oneSentenceRead;

  const positionGuidance =
    Array.isArray(prose.positionGuidance) &&
    prose.positionGuidance.length > 0 &&
    prose.positionGuidance.every((s) => typeof s === "string")
      ? prose.positionGuidance
      : base.positionGuidance;

  const riskNotes =
    Array.isArray(prose.riskNotes) &&
    prose.riskNotes.length > 0 &&
    prose.riskNotes.every((s) => typeof s === "string")
      ? prose.riskNotes
      : base.riskNotes;

  return { ...base, oneSentenceRead, positionGuidance, riskNotes };
}

/** Drops any list entries that contain forbidden language. */
function dropForbidden(items: string[]): string[] {
  return items.filter((s) => scanForbidden(s).length === 0);
}

/** Returns an agent read with any forbidden language scrubbed from its text. */
function sanitizeAgent(agent: AgentRead): AgentRead {
  return {
    ...agent,
    headline:
      scanForbidden(agent.headline).length > 0
        ? "Deterministic read only."
        : agent.headline,
    supportingFactors: dropForbidden(agent.supportingFactors),
    warnings: dropForbidden(agent.warnings),
  };
}

function finalize(input: FinalizeInput): CommitteeResult {
  // Absolute final recommendation gate (idempotent; cannot be escaped).
  const gatedRec = enforceHardBlock(input.dashboardRead.recommendation, input.event);
  const dashboardRead: DashboardRead =
    gatedRec === input.dashboardRead.recommendation
      ? input.dashboardRead
      : { ...input.dashboardRead, recommendation: gatedRec };

  const result: CommitteeResult = {
    status: input.status,
    source: input.source,
    eventId: input.event.eventId,
    symbol: input.event.symbol,
    alertLevel: input.event.alertLevel,
    l5Blocked: input.event.l5Blocked,
    provider: input.provider,
    degraded: input.degraded,
    agents: input.agents,
    dashboardRead,
    warnings: input.warnings,
  };

  // Final forbidden-language sweep over the ENTIRE payload. Deterministic agent
  // text is clean by construction, so the realistic source is provider prose or
  // event-derived warnings; if anything trips, fall back to the guaranteed-safe
  // read AND scrub every other text-bearing field so nothing unsafe escapes.
  if (scanForbiddenDeep(result).length > 0) {
    const safe = safetyNetRead(input.event);
    result.dashboardRead = {
      ...safe,
      recommendation: enforceHardBlock(safe.recommendation, input.event),
    };
    result.agents = input.agents.map(sanitizeAgent);
    result.degraded = true;
    result.status = "FALLBACK";
    result.source = "deterministic_fallback";
    result.warnings = uniq([
      ...dropForbidden(input.warnings),
      "Forbidden language detected and removed; using deterministic safety read.",
    ]);
  }

  return result;
}

/**
 * Runs the analyst committee on one deterministic event. Pass a provider to
 * enable prose-only LLM enrichment; omit it (or pass null) for a pure
 * deterministic multi-agent read.
 */
export async function runCommittee(
  event: CopilotEvent,
  provider?: CommitteeProvider | null,
): Promise<CommitteeResult> {
  const reads = runAgents(event);
  const agents = readsToArray(reads);

  let dashboardRead: DashboardRead = synthesize(event, reads);

  // If the deterministic output somehow fails validation, drop to the safety net.
  const deterministicErrors = [
    ...agents.flatMap(validateAgentRead),
    ...validateDashboardRead(dashboardRead),
  ];
  if (deterministicErrors.length > 0) {
    dashboardRead = safetyNetRead(event);
  }

  const baseWarnings = uniq(event.warnings);

  // No provider: the deterministic multi-agent committee IS the answer.
  if (!provider) {
    return finalize({
      status: "OK",
      source: "multi_agent_committee",
      provider: "deterministic",
      degraded: false,
      event,
      agents,
      dashboardRead,
      warnings: baseWarnings,
    });
  }

  // Provider present: attempt prose-only enrichment, fully sandboxed.
  try {
    const context: ProviderContext = {
      symbol: event.symbol,
      alertLevel: event.alertLevel,
      l5Blocked: event.l5Blocked,
      recommendation: dashboardRead.recommendation,
      agents,
      deterministicRead: dashboardRead,
    };
    const prose = await provider.enrich(context);
    const enriched = applyProse(dashboardRead, prose);

    // Grounding: every number the prose mentions must already appear in the
    // deterministic read or the specialist agents. This blocks the LLM from
    // inventing prices, levels, percentages, or dates not in the source data.
    const grounding = JSON.stringify({ read: dashboardRead, agents, symbol: event.symbol });
    const proseOnly = {
      oneSentenceRead: enriched.oneSentenceRead,
      positionGuidance: enriched.positionGuidance,
      riskNotes: enriched.riskNotes,
    };
    const ungrounded = ungroundedNumbers(proseOnly, grounding);

    const enrichedErrors = validateDashboardRead(enriched);
    if (
      enrichedErrors.length === 0 &&
      scanForbiddenDeep(enriched).length === 0 &&
      ungrounded.length === 0
    ) {
      return finalize({
        status: "OK",
        source: "multi_agent_committee",
        provider: provider.name,
        degraded: false,
        event,
        agents,
        dashboardRead: enriched,
        warnings: baseWarnings,
      });
    }

    const rejectionWarning =
      ungrounded.length > 0
        ? "AI enrichment introduced ungrounded figures; using deterministic read."
        : "AI enrichment rejected by guardrails; using deterministic read.";

    return finalize({
      status: "FALLBACK",
      source: "deterministic_fallback",
      provider: provider.name,
      degraded: true,
      event,
      agents,
      dashboardRead,
      warnings: uniq([...baseWarnings, rejectionWarning]),
    });
  } catch {
    return finalize({
      status: "FALLBACK",
      source: "deterministic_fallback",
      provider: provider.name,
      degraded: true,
      event,
      agents,
      dashboardRead,
      warnings: uniq([...baseWarnings, "AI provider failed; using deterministic read."]),
    });
  }
}
