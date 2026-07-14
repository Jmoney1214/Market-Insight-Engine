/**
 * Macro Context Analyst — a deterministic trigger router decides WHETHER macro
 * context is required (the model never decides to run itself): scheduled
 * macro-event windows (Fed/CPI/NFP style) and index-move thresholds.
 * Not triggered → RETURN_NOT_REQUIRED with an explicitly-empty context.
 *
 * Vintage-aware: every event value carries its revisionStatus; when the same
 * eventType appears at multiple vintages, the most authoritative one is kept
 * (FINAL > REVISED > PRELIMINARY > UNKNOWN) — values are never blended.
 */
import type { MacroContext } from "@workspace/research-contracts";

export interface MacroCalendarEvent {
  eventType: string;
  scheduledTime: string | null;
  reportedValue: number | null;
  consensusValue: number | null;
  unit: string | null;
  revisionStatus: "PRELIMINARY" | "REVISED" | "FINAL" | "UNKNOWN";
  sourceDocumentId: string | null;
}

export interface MacroTriggerInput {
  now: string;
  calendar: MacroCalendarEvent[];
  /** Signed intraday % move of the reference index (e.g. SPY), null if unknown. */
  indexMovePct: number | null;
  windowHoursBefore?: number;
  windowHoursAfter?: number;
  indexMoveThresholdPct?: number;
}

export interface MacroTrigger {
  required: boolean;
  triggerReasonCodes: string[];
  /** Calendar events inside the active window (post-vintage-selection). */
  activeEvents: MacroCalendarEvent[];
}

const VINTAGE_RANK = { FINAL: 3, REVISED: 2, PRELIMINARY: 1, UNKNOWN: 0 } as const;

/** Keep the most authoritative vintage per eventType — never blend values. */
export function pickVintage(events: MacroCalendarEvent[]): MacroCalendarEvent[] {
  const best = new Map<string, MacroCalendarEvent>();
  for (const e of events) {
    const current = best.get(e.eventType);
    if (!current || VINTAGE_RANK[e.revisionStatus] > VINTAGE_RANK[current.revisionStatus]) {
      best.set(e.eventType, e);
    }
  }
  return [...best.values()];
}

export function shouldRunMacro(input: MacroTriggerInput): MacroTrigger {
  const before = (input.windowHoursBefore ?? 24) * 3_600_000;
  const after = (input.windowHoursAfter ?? 4) * 3_600_000;
  const threshold = input.indexMoveThresholdPct ?? 1.0;
  const nowMs = new Date(input.now).getTime();

  const reasons: string[] = [];
  const inWindow = input.calendar.filter((e) => {
    if (e.scheduledTime == null) return false;
    const t = new Date(e.scheduledTime).getTime();
    return t >= nowMs - after && t <= nowMs + before;
  });
  if (inWindow.length > 0) {
    reasons.push(...[...new Set(inWindow.map((e) => `${e.eventType}_RELEASE_WINDOW`))]);
  }
  if (input.indexMovePct != null && Math.abs(input.indexMovePct) >= threshold) {
    reasons.push("INDEX_MOVE_THRESHOLD");
  }

  return {
    required: reasons.length > 0,
    triggerReasonCodes: reasons,
    activeEvents: pickVintage(inWindow),
  };
}

export interface BuildMacroContextInput {
  macroContextId: string;
  trigger: MacroTrigger;
  tickerSensitivity?: MacroContext["tickerSensitivity"];
  causalConfidence?: MacroContext["causalConfidence"];
  now: string;
}

export function buildMacroContext(input: BuildMacroContextInput): MacroContext {
  const { trigger } = input;
  return {
    contract: "MacroContext",
    version: "1.0.0",
    macroContextId: input.macroContextId,
    required: trigger.required,
    triggerReasonCodes: trigger.triggerReasonCodes,
    activeEvents: trigger.required ? trigger.activeEvents : [],
    tickerSensitivity: trigger.required ? (input.tickerSensitivity ?? "UNKNOWN") : "UNKNOWN",
    causalConfidence: trigger.required ? (input.causalConfidence ?? "UNKNOWN") : "UNKNOWN",
    unknownFields: [],
    asOf: input.now,
  };
}
