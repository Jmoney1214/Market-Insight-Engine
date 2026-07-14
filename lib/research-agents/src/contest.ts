/**
 * Second Verifier contest mode (ContestTrade pattern): the same catalyst is
 * verified twice by INDEPENDENT runs (different narrator backbones), then this
 * deterministic resolver compares the two records field by field.
 *
 * Agreements pass through unchanged. Disagreements emit Conflict records and
 * mark the merged record CONFLICTED — values are never averaged or silently
 * reconciled (system rule).
 */
import type { CatalystRecord, Conflict } from "@workspace/research-contracts";

/** Fields the contest compares; everything else is provenance, not judgment. */
const CONTESTED_FIELDS = [
  "eventType",
  "verificationStatus",
  "materiality",
  "publicationTime",
  "eventTime",
  "firstKnownTime",
] as const;
type ContestedField = (typeof CONTESTED_FIELDS)[number];

export interface ContestResult {
  agreed: boolean;
  /** Primary record when agreed; primary marked CONFLICTED (+conflictIds) when not. */
  record: CatalystRecord;
  /**
   * The independent second verification, returned so it is persisted and
   * judged in its own right — without it, second-verifier accuracy can never
   * be measured (the merged record always keeps the primary's identity).
   */
  secondary: CatalystRecord;
  conflicts: Conflict[];
  disagreeingFields: ContestedField[];
}

function asComparable(value: CatalystRecord[ContestedField]): string {
  return value === null ? "NULL" : String(value);
}

export function resolveContest(input: {
  primary: CatalystRecord;
  secondary: CatalystRecord;
  now: string;
  conflictIdPrefix: string;
}): ContestResult {
  const { primary, secondary } = input;
  if (primary.symbol !== secondary.symbol) {
    throw new Error("contest requires two verifications of the same symbol");
  }

  const disagreeingFields = CONTESTED_FIELDS.filter(
    (f) => asComparable(primary[f]) !== asComparable(secondary[f]),
  );

  if (disagreeingFields.length === 0) {
    return { agreed: true, record: primary, secondary, conflicts: [], disagreeingFields: [] };
  }

  const conflicts: Conflict[] = disagreeingFields.map((field, i) => ({
    contract: "Conflict",
    version: "1.0.0",
    conflictId: `${input.conflictIdPrefix}_${i + 1}`,
    fieldPath: `/${field}`,
    values: [
      { value: asComparable(primary[field]), sourceDocumentId: primary.catalystId },
      { value: asComparable(secondary[field]), sourceDocumentId: secondary.catalystId },
    ],
    resolutionStatus: "UNRESOLVED",
    preferredValue: null,
    createdAt: input.now,
  }));

  const record: CatalystRecord = {
    ...primary,
    verificationStatus: "CONFLICTED",
    conflictIds: [...primary.conflictIds, ...conflicts.map((c) => c.conflictId)],
  };

  return { agreed: false, record, secondary, conflicts, disagreeingFields: [...disagreeingFields] };
}
