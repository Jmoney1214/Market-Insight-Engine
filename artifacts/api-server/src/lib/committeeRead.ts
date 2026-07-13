import type { CommitteeResult } from "@workspace/copilot-committee";
import type { CommitteeRead as ApiCommitteeRead } from "@workspace/api-zod";

/**
 * Maps the committee result onto the generated API wire type. Typing the return
 * as the generated {@link ApiCommitteeRead} makes the boundary explicit: if the
 * committee output drifts from the OpenAPI contract, this fails to compile.
 * Arrays are copied so the wire payload never aliases internal state.
 */
type CommitteeProvenance = Pick<
  ApiCommitteeRead,
  "provenanceMode" | "caseRevisionId" | "evidenceHash"
>;

export function committeeResultToApiRead(
  result: CommitteeResult,
  provenance: CommitteeProvenance,
): ApiCommitteeRead {
  return {
    status: result.status,
    source: result.source,
    eventId: result.eventId,
    symbol: result.symbol,
    alertLevel: result.alertLevel,
    l5Blocked: result.l5Blocked,
    provider: result.provider,
    degraded: result.degraded,
    agents: result.agents.map((a) => ({
      agent: a.agent,
      status: a.status,
      bias: a.bias,
      confidence: a.confidence,
      headline: a.headline,
      supportingFactors: [...a.supportingFactors],
      warnings: [...a.warnings],
      riskVerdict: a.riskVerdict,
      maxRecommendation: a.maxRecommendation,
    })),
    dashboardRead: {
      oneSentenceRead: result.dashboardRead.oneSentenceRead,
      recommendation: result.dashboardRead.recommendation,
      confidence: result.dashboardRead.confidence,
      whatSupports: [...result.dashboardRead.whatSupports],
      whatArguesAgainst: [...result.dashboardRead.whatArguesAgainst],
      whatConfirms: [...result.dashboardRead.whatConfirms],
      whatInvalidates: [...result.dashboardRead.whatInvalidates],
      positionGuidance: [...result.dashboardRead.positionGuidance],
      riskNotes: [...result.dashboardRead.riskNotes],
    },
    warnings: [...result.warnings],
    ...provenance,
  };
}
