// Pure helpers that build journal `manualOutcome` payloads for the desk's
// measurement subsystem. Kept free of React and network code so the
// action -> outcome mapping is unit-testable in isolation.
//
// SAFETY / HONESTY: manual qualitative annotations deliberately use action keys
// that are NOT in the server's scoreable whitelist (closed / manually_tracked /
// target_hit / stop_hit). The server extractor therefore ignores them, so a
// trader logging "watched" or "good alert" can never manufacture an edge sample.

export type OutcomeConfidence =
  | "MANUAL_CONFIRMED"
  | "MANUAL_ESTIMATED"
  | "CURRENT_PRICE_ASSUMED"
  | "WATCH_ONLY"
  | "INVALID_SAMPLE";

export interface ManualAction {
  /** Recorded as `manualOutcome.action`; intentionally non-scoreable. */
  key: string;
  label: string;
  outcomeConfidence: OutcomeConfidence;
  description: string;
}

export const MANUAL_ACTIONS: readonly ManualAction[] = [
  {
    key: "watched",
    label: "WATCHED",
    outcomeConfidence: "WATCH_ONLY",
    description: "Observed the alert, took no position",
  },
  {
    key: "ignored",
    label: "IGNORED",
    outcomeConfidence: "WATCH_ONLY",
    description: "Deliberately passed on the alert",
  },
  {
    key: "skipped_risk",
    label: "SKIPPED · RISK",
    outcomeConfidence: "WATCH_ONLY",
    description: "Skipped — risk too high",
  },
  {
    key: "skipped_uncertainty",
    label: "SKIPPED · UNCERTAINTY",
    outcomeConfidence: "WATCH_ONLY",
    description: "Skipped — setup unclear",
  },
  {
    key: "false_alert",
    label: "FALSE ALERT",
    outcomeConfidence: "INVALID_SAMPLE",
    description: "Alert did not reflect reality",
  },
  {
    key: "good_alert",
    label: "GOOD ALERT",
    outcomeConfidence: "WATCH_ONLY",
    description: "Alert was accurate and useful",
  },
];

export type ManualActionOutcome = {
  action: string;
  outcomeConfidence: OutcomeConfidence;
};

/** Map a manual annotation key to its (non-scoreable) outcome payload. */
export function buildManualActionOutcome(key: string): ManualActionOutcome | null {
  const found = MANUAL_ACTIONS.find((a) => a.key === key);
  if (!found) return null;
  return { action: found.key, outcomeConfidence: found.outcomeConfidence };
}

function coerceR(value: number | string | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export interface CloseOutcomeArgs {
  strategyName: string | null | undefined;
  rMultiple: number | string | null | undefined;
  /** true → MANUAL_CONFIRMED (promotable); false → CURRENT_PRICE_ASSUMED (never promotes). */
  confirmed: boolean;
  direction?: string | null;
}

export interface CloseOutcome {
  action: "closed";
  strategyName: string;
  rMultiple: number;
  outcomeConfidence: "MANUAL_CONFIRMED" | "CURRENT_PRICE_ASSUMED";
  direction?: string;
}

/**
 * Build a scoreable "closed" outcome for the position tracker. Returns null
 * unless there is a named strategy AND a finite R multiple — without both, the
 * sample is meaningless and we refuse to journal a fake outcome.
 */
export function buildCloseOutcome(args: CloseOutcomeArgs): CloseOutcome | null {
  const strategyName =
    typeof args.strategyName === "string" ? args.strategyName.trim() : "";
  if (!strategyName) return null;

  const rMultiple = coerceR(args.rMultiple);
  if (rMultiple === null) return null;

  const outcome: CloseOutcome = {
    action: "closed",
    strategyName,
    rMultiple,
    outcomeConfidence: args.confirmed ? "MANUAL_CONFIRMED" : "CURRENT_PRICE_ASSUMED",
  };
  const direction =
    typeof args.direction === "string" && args.direction.trim() !== ""
      ? args.direction.trim()
      : undefined;
  if (direction) outcome.direction = direction;
  return outcome;
}
