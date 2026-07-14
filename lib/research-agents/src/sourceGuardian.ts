/**
 * Source Guardian — FAIL_CLOSED claim auditor. A claim enters a packet ONLY
 * with a SUPPORTED audit; anything unaudited, unverifiable, or conflicted is
 * kept out. Silence never admits a claim.
 *
 * Deterministic here: source-class policy, syndication lineage (ten copies of
 * one wire story = ONE independent source), correction supersession, entity
 * and numeric consistency, temporal freshness. The entailment provider only
 * judges claim↔passage support; its output is strictly parsed and a missing or
 * failing provider fails closed to UNKNOWN.
 */
import { z } from "zod/v4";
import type { Claim, SourceAudit, SourceDocument } from "@workspace/research-contracts";

const TRUSTED_FOR_CORE = new Set([
  "PRIMARY_REGULATOR",
  "PRIMARY_COMPANY",
  "PRIMARY_EXCHANGE",
  "LICENSED_WIRE",
  "LICENSED_ANALYTICS",
]);

export const EntailmentVerdict = z.strictObject({
  perPassage: z.array(
    z.strictObject({
      sourceDocumentId: z.string().min(1),
      verdict: z.enum(["ENTAILS", "CONTRADICTS", "NEUTRAL"]),
    }),
  ),
});
export type EntailmentVerdict = z.infer<typeof EntailmentVerdict>;

export interface EntailmentProvider {
  name: string;
  judge(input: {
    claimText: string;
    passages: Array<{ sourceDocumentId: string; text: string }>;
  }): Promise<unknown>;
}

export interface AuditClaimInput {
  auditId: string;
  claim: Claim;
  /** Every document the claim's evidence references, by id. */
  documents: Map<string, SourceDocument>;
  /** Passage text per evidence entry, keyed by sourceDocumentId. */
  passages: Map<string, string>;
  /** sourceDocumentId → syndication cluster key (from the news-event scanner). */
  syndication?: Map<string, string>;
  /** superseded sourceDocumentId → correcting sourceDocumentId. */
  corrections?: Map<string, string>;
  entailment?: EntailmentProvider | null;
  now: string;
  maxAgeDays?: number;
  agentVersion?: string;
}

export interface AuditedClaim {
  audit: SourceAudit;
  /** True ONLY for SUPPORTED audits — the packet admission gate. */
  admitted: boolean;
}

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000;
}

/** Distinct syndication clusters among the given documents (unmapped = itself). */
export function independentSourceCount(
  sourceIds: string[],
  syndication: Map<string, string> | undefined,
): number {
  return new Set(sourceIds.map((id) => syndication?.get(id) ?? id)).size;
}

const NUMBER_RE = /-?\d+(?:,\d{3})*(?:\.\d+)?/g;

/** True when the claim's numeric value appears verbatim in any passage. */
export function numericConsistent(value: number, passages: string[]): boolean {
  const wanted = String(value);
  for (const text of passages) {
    for (const raw of text.match(NUMBER_RE) ?? []) {
      if (raw.replace(/,/g, "") === wanted) return true;
    }
  }
  return false;
}

export async function auditClaim(input: AuditClaimInput): Promise<AuditedClaim> {
  const { claim } = input;
  const reasonCodes: string[] = [];
  const excludedSources: SourceAudit["excludedSources"] = [];

  // Corrections supersede: a corrected document cannot support anything.
  const evidenceIds = claim.evidence.map((e) => e.sourceDocumentId);
  const activeIds: string[] = [];
  for (const id of evidenceIds) {
    const correctedBy = input.corrections?.get(id);
    if (correctedBy) {
      excludedSources.push({ sourceDocumentId: id, reasonCode: "SUPERSEDED_BY_CORRECTION" });
    } else if (!input.documents.has(id)) {
      excludedSources.push({ sourceDocumentId: id, reasonCode: "DOCUMENT_NOT_PROVIDED" });
    } else {
      activeIds.push(id);
    }
  }

  const activeDocs = activeIds.map((id) => input.documents.get(id)!);

  // Entity check: every supporting doc must mention the claimed symbol.
  const entityStatus: SourceAudit["entityStatus"] =
    activeDocs.length === 0
      ? "UNKNOWN"
      : activeDocs.every((d) => d.symbols.includes(claim.symbol))
        ? "MATCHED"
        : "MISMATCHED";

  // Source-class policy: CORE claims need at least one trusted-class source.
  const hasTrusted = activeDocs.some((d) => TRUSTED_FOR_CORE.has(d.sourceClass));
  if (claim.criticality === "CORE" && !hasTrusted && activeDocs.length > 0) {
    reasonCodes.push("CORE_CLAIM_LACKS_TRUSTED_SOURCE");
  }
  if (hasTrusted) reasonCodes.push("TRUSTED_SOURCE_PRESENT");

  // Syndication lineage: collapse wire copies to independent sources.
  const independent = independentSourceCount(activeIds, input.syndication);
  if (activeIds.length > independent) {
    reasonCodes.push("SYNDICATED_COPIES_COLLAPSED");
  }

  // Temporal freshness of the supporting evidence.
  const maxAge = input.maxAgeDays ?? 7;
  const times = activeDocs.map((d) => d.publicationTime).filter((t): t is string => t != null);
  const temporalStatus: SourceAudit["temporalStatus"] =
    times.length === 0
      ? "UNKNOWN"
      : times.some((t) => daysBetween(t, input.now) <= maxAge)
        ? "CURRENT"
        : "STALE";

  // Numeric consistency for structured numeric claims.
  const passageTexts = activeIds
    .map((id) => input.passages.get(id))
    .filter((t): t is string => typeof t === "string");
  const numericStatus: SourceAudit["numericStatus"] =
    typeof claim.structuredValue === "number"
      ? numericConsistent(claim.structuredValue, passageTexts)
        ? "CONSISTENT"
        : "INCONSISTENT"
      : "NOT_APPLICABLE";

  // Claim↔passage entailment — provider-judged, strictly parsed, fail-closed.
  let validationStatus: SourceAudit["validationStatus"] = "UNKNOWN";
  if (activeDocs.length === 0) {
    validationStatus = "UNKNOWN";
    reasonCodes.push("NO_ACTIVE_EVIDENCE");
  } else if (!input.entailment) {
    reasonCodes.push("ENTAILMENT_UNAVAILABLE");
  } else {
    try {
      const raw = await input.entailment.judge({
        claimText: claim.text,
        passages: activeIds.map((id) => ({
          sourceDocumentId: id,
          text: input.passages.get(id) ?? "",
        })),
      });
      const parsed = EntailmentVerdict.safeParse(raw);
      if (!parsed.success) {
        reasonCodes.push("ENTAILMENT_OUTPUT_REJECTED");
      } else {
        const verdicts = parsed.data.perPassage.filter((p) => activeIds.includes(p.sourceDocumentId));
        const entails = verdicts.filter((p) => p.verdict === "ENTAILS").length;
        const contradicts = verdicts.filter((p) => p.verdict === "CONTRADICTS").length;
        if (contradicts > 0 && entails > 0) validationStatus = "CONFLICTED";
        else if (contradicts > 0) validationStatus = "UNSUPPORTED";
        else if (entails === verdicts.length && entails > 0) validationStatus = "SUPPORTED";
        else if (entails > 0) validationStatus = "PARTIALLY_SUPPORTED";
        else validationStatus = "UNSUPPORTED";
        reasonCodes.push(validationStatus === "SUPPORTED" ? "PASSAGE_ENTAILS_CLAIM" : "PASSAGE_SUPPORT_INCOMPLETE");
      }
    } catch {
      reasonCodes.push("ENTAILMENT_PROVIDER_FAILED");
    }
  }

  // Deterministic overrides: hard failures cap the status regardless of entailment.
  if (entityStatus === "MISMATCHED") {
    validationStatus = "UNSUPPORTED";
    reasonCodes.push("ENTITY_MISMATCH");
  }
  if (numericStatus === "INCONSISTENT") {
    validationStatus = validationStatus === "SUPPORTED" ? "CONFLICTED" : validationStatus;
    reasonCodes.push("NUMERIC_INCONSISTENT");
  }
  if (claim.criticality === "CORE" && !hasTrusted) {
    validationStatus = validationStatus === "SUPPORTED" ? "PARTIALLY_SUPPORTED" : validationStatus;
  }

  const audit: SourceAudit = {
    contract: "SourceAudit",
    version: "1.0.0",
    auditId: input.auditId,
    claimId: claim.claimId,
    validationStatus,
    supportingSourceIds: validationStatus === "SUPPORTED" || validationStatus === "PARTIALLY_SUPPORTED" ? activeIds : [],
    excludedSources,
    temporalStatus,
    entityStatus,
    numericStatus,
    auditReasonCodes: reasonCodes,
    auditedBy: "source-guardian",
    agentVersion: input.agentVersion ?? "1.0.0",
    createdAt: input.now,
  };

  return { audit, admitted: validationStatus === "SUPPORTED" };
}

/** The packet gate: only claims with an admitting audit may enter. */
export function admittedClaims(claims: Claim[], audits: AuditedClaim[]): Claim[] {
  const admitted = new Set(audits.filter((a) => a.admitted).map((a) => a.audit.claimId));
  return claims.filter((c) => admitted.has(c.claimId));
}
