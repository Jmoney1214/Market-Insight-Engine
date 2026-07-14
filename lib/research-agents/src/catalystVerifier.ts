/**
 * Catalyst Verifier — answers the brief's nine questions about a catalyst.
 *
 * Division of labor (system law): the LLM provider only NARRATES the event
 * description and proposes an event-type classification over pre-fetched
 * evidence. Every verification decision — entity match, staleness, primary
 * source presence, timestamps, and the final VerificationStatus — is computed
 * by the deterministic code in this file. No provider → RETURN_UNKNOWN.
 */
import { z } from "zod/v4";
import {
  CatalystEventType,
  type CatalystRecord,
  type SourceDocument,
  type UnknownField,
} from "@workspace/research-contracts";

export const NINE_QUESTIONS = [
  "Q1 What exactly happened?",
  "Q2 Which entity does it concern (exact match)?",
  "Q3 When was it published?",
  "Q4 When did the event occur?",
  "Q5 When was it first knowable?",
  "Q6 Is it new?",
  "Q7 Is it a stale re-run of older news?",
  "Q8 Was it corrected or retracted?",
  "Q9 Is a primary source present?",
] as const;

/** A news cluster row from the news-event scanner (point-in-time first-seen). */
export interface NewsClusterEvidence {
  clusterKey: string;
  headline: string;
  isRepeat: boolean;
  firstSeen: string;
  publishedAt: string;
}

export interface CatalystEvidence {
  documents: SourceDocument[];
  newsClusters: NewsClusterEvidence[];
  /** Source-document ids known to be corrections/retractions of earlier docs. */
  correctionSourceIds?: string[];
}

/** Structured output the narrator provider must return (strictly parsed). */
export const NarratedCatalyst = z.strictObject({
  eventType: CatalystEventType,
  eventDescription: z.string().min(1).max(600),
});
export type NarratedCatalyst = z.infer<typeof NarratedCatalyst>;

export interface CatalystNarrator {
  name: string;
  /** Receives the questions plus pre-fetched evidence; returns NarratedCatalyst JSON. */
  narrate(input: {
    symbol: string;
    questions: readonly string[];
    documents: SourceDocument[];
    newsClusters: NewsClusterEvidence[];
  }): Promise<unknown>;
}

const PRIMARY_CLASSES = new Set(["PRIMARY_REGULATOR", "PRIMARY_COMPANY", "PRIMARY_EXCHANGE"]);

export interface DeterministicChecks {
  entityMatched: boolean | null;
  primarySourcePresent: boolean;
  stale: boolean | null;
  corrected: boolean;
  hasEvidence: boolean;
}

/** The deterministic answers — computed from evidence, never from the model. */
export function computeChecks(symbol: string, evidence: CatalystEvidence): DeterministicChecks {
  const docs = evidence.documents;
  const clusters = evidence.newsClusters;
  const hasEvidence = docs.length > 0 || clusters.length > 0;
  const entityMatched = docs.length > 0 ? docs.some((d) => d.symbols.includes(symbol)) : null;
  const primarySourcePresent = docs.some((d) => PRIMARY_CLASSES.has(d.sourceClass));
  const stale = clusters.length > 0 ? clusters.every((c) => c.isRepeat) : null;
  const corrected = (evidence.correctionSourceIds ?? []).length > 0;
  return { entityMatched, primarySourcePresent, stale, corrected, hasEvidence };
}

/** Deterministic decision table — the model never touches this. */
export function decideVerificationStatus(c: DeterministicChecks): CatalystRecord["verificationStatus"] {
  if (!c.hasEvidence) return "UNKNOWN";
  if (c.corrected) return "RETRACTED_OR_CORRECTED";
  if (c.entityMatched === false) return "UNSUPPORTED";
  if (c.stale === true) return "STALE";
  if (c.primarySourcePresent && c.entityMatched === true) return "CONFIRMED";
  if (c.primarySourcePresent) return "PARTIALLY_CONFIRMED";
  return "PRIMARY_SOURCE_MISSING";
}

/** Fallback classification when no narrator is available — evidence-derived only. */
export function deterministicEventType(evidence: CatalystEvidence): CatalystRecord["eventType"] {
  const doc = evidence.documents.find((d) => d.documentType.toUpperCase().startsWith("SEC_"));
  if (doc) return "SEC_FILING";
  return "PRESS_RELEASE";
}

function earliest(values: Array<string | null>): string | null {
  const present = values.filter((v): v is string => v != null).sort();
  return present[0] ?? null;
}

export interface VerifyCatalystInput {
  catalystId: string;
  symbol: string;
  evidence: CatalystEvidence;
  narrator?: CatalystNarrator | null;
  now: string;
  expiresAt: string;
  claimIds?: string[];
  agentVersion?: string;
}

/**
 * Builds a CatalystRecord from pre-fetched evidence. Narration is optional and
 * sandboxed: a missing, throwing, or schema-violating narrator degrades to the
 * deterministic description (quoted evidence), never to a failure.
 */
export async function verifyCatalyst(input: VerifyCatalystInput): Promise<CatalystRecord> {
  const { evidence, symbol } = input;
  const checks = computeChecks(symbol, evidence);
  const verificationStatus = decideVerificationStatus(checks);

  const primarySourceIds = evidence.documents
    .filter((d) => PRIMARY_CLASSES.has(d.sourceClass))
    .map((d) => d.sourceDocumentId);
  const secondarySourceIds = evidence.documents
    .filter((d) => !PRIMARY_CLASSES.has(d.sourceClass))
    .map((d) => d.sourceDocumentId);

  const publicationTime = earliest([
    ...evidence.documents.map((d) => d.publicationTime),
    ...evidence.newsClusters.map((c) => c.publishedAt),
  ]);
  const eventTime = earliest(evidence.documents.map((d) => d.eventTime));
  const firstKnownTime = earliest([
    ...evidence.documents.map((d) => d.firstKnownTime),
    ...evidence.newsClusters.map((c) => c.firstSeen),
  ]);

  // Deterministic description: quote the evidence verbatim (never invent).
  const quoted =
    evidence.newsClusters[0]?.headline ??
    evidence.documents[0]?.documentType ??
    "No catalyst evidence provided.";
  let eventType = deterministicEventType(evidence);
  let eventDescription = quoted;
  const unknownFields: UnknownField[] = [];

  if (input.narrator && checks.hasEvidence) {
    try {
      const raw = await input.narrator.narrate({
        symbol,
        questions: NINE_QUESTIONS,
        documents: evidence.documents,
        newsClusters: evidence.newsClusters,
      });
      const parsed = NarratedCatalyst.safeParse(raw);
      if (parsed.success) {
        eventType = parsed.data.eventType;
        eventDescription = parsed.data.eventDescription;
      } else {
        unknownFields.push({
          path: "/eventDescription",
          reasonCode: "NARRATOR_OUTPUT_REJECTED",
          attemptedSourceIds: [],
          blocking: false,
        });
      }
    } catch {
      unknownFields.push({
        path: "/eventDescription",
        reasonCode: "NARRATOR_UNAVAILABLE",
        attemptedSourceIds: [],
        blocking: false,
      });
    }
  } else if (!input.narrator) {
    unknownFields.push({
      path: "/eventType",
      reasonCode: "NARRATOR_NOT_CONFIGURED",
      attemptedSourceIds: [],
      blocking: false,
    });
  }
  if (!checks.hasEvidence) {
    unknownFields.push({
      path: "/verificationStatus",
      reasonCode: "NO_EVIDENCE_PROVIDED",
      attemptedSourceIds: [],
      blocking: true,
    });
  }

  const repeated = evidence.newsClusters.find((c) => c.isRepeat);

  return {
    contract: "CatalystRecord",
    version: "1.0.0",
    catalystId: input.catalystId,
    symbol,
    eventType,
    eventDescription,
    publicationTime,
    eventTime,
    firstKnownTime,
    verificationStatus,
    materiality: verificationStatus === "CONFIRMED" ? "POSSIBLY_MATERIAL" : "UNKNOWN",
    primarySourceIds,
    secondarySourceIds,
    claimIds: input.claimIds ?? [],
    conflictIds: [],
    duplicateClusterId: repeated ? repeated.clusterKey : null,
    correctionOfCatalystId: null,
    unknownFields,
    retrievedAt: input.now,
    asOf: input.now,
    expiresAt: input.expiresAt,
  };
}
