/**
 * FMP economic calendar → MacroCalendarEvent mapping for the deterministic
 * macro trigger router (Wave 2).
 *
 * Only US, market-moving release families are kept (CPI/FOMC/NFP-class).
 * Vintage honesty: FMP exposes no revision history, so a released number is
 * PRELIMINARY (first print) and an upcoming one is UNKNOWN — the router's
 * never-blend rule stays intact.
 */
import type { MacroCalendarEvent } from "@workspace/research-agents";
import type { FmpEconomicEvent } from "./providers/fmp.js";
import { etOffset } from "./etTime.js";

/** Release families the macro router cares about, by canonical event type. */
const EVENT_FAMILIES: Array<{ eventType: string; pattern: RegExp }> = [
  { eventType: "FOMC", pattern: /fomc|fed(eral)?\s*(funds|reserve)|interest rate decision/i },
  { eventType: "CPI", pattern: /\bcpi\b|consumer price/i },
  { eventType: "PPI", pattern: /\bppi\b|producer price/i },
  { eventType: "NFP", pattern: /non-?farm|nonfarm payroll/i },
  { eventType: "JOBLESS_CLAIMS", pattern: /jobless claims|unemployment claims/i },
  { eventType: "UNEMPLOYMENT_RATE", pattern: /unemployment rate/i },
  { eventType: "GDP", pattern: /\bgdp\b|gross domestic/i },
  { eventType: "PCE", pattern: /\bpce\b|personal consumption/i },
  { eventType: "RETAIL_SALES", pattern: /retail sales/i },
  { eventType: "ISM_PMI", pattern: /\bism\b|\bpmi\b|purchasing managers/i },
];

export function classifyEconomicEvent(eventName: string): string | null {
  const family = EVENT_FAMILIES.find((f) => f.pattern.test(eventName));
  return family ? family.eventType : null;
}

/**
 * FMP dates are US/Eastern wall-clock ("YYYY-MM-DD HH:mm:ss"); tag them with
 * the DST-correct offset for that date (EDT -04:00 / EST -05:00).
 */
export function fmpDateToIso(date: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?$/.exec(date.trim());
  if (!m) return null;
  return `${m[1]}T${m[2]}:00${etOffset(m[1]!)}`;
}

/** Pure: FMP rows → router calendar events (US, recognized families only). */
export function mapEconomicCalendar(rows: FmpEconomicEvent[]): MacroCalendarEvent[] {
  const out: MacroCalendarEvent[] = [];
  for (const row of rows) {
    if (!/^(US|USA|United States)$/i.test(row.country)) continue;
    const eventType = classifyEconomicEvent(row.event);
    if (!eventType) continue;
    const scheduledTime = fmpDateToIso(row.date);
    if (!scheduledTime) continue;
    out.push({
      eventType,
      scheduledTime,
      reportedValue: row.actual,
      consensusValue: row.estimate,
      unit: row.unit,
      // First print at best — FMP carries no revision lineage.
      revisionStatus: row.actual != null ? "PRELIMINARY" : "UNKNOWN",
      sourceDocumentId: null,
    });
  }
  return out;
}
