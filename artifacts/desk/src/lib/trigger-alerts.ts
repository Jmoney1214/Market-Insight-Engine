// Deterministic trigger-transition alert layer.
//
// SAFETY: This is a research terminal. Alerts are NEVER actionable. When the
// event is hard-blocked (L5 / l5Blocked) no alert is ever produced, so a
// blocked read can never surface a trigger as if it were tradeable. The
// transition detection is fully deterministic (no LLM): an alert fires only on
// a false -> true edge of a detected trigger, computed by the shared core
// helper. Every AI-free `detail` string is still run through safeText as
// defense-in-depth before it can reach the banner.

import { newlyFiredTriggers } from "@workspace/copilot-core";
import type { CopilotEvent, CopilotTrigger } from "@workspace/api-client-react";
import { safeText } from "./safety";

export interface TriggerAlert {
  name: string;
  category: CopilotTrigger["category"];
  detail: string | null;
  alertLevel: CopilotEvent["alertLevel"];
}

/**
 * Diff the previous and current events and return the triggers that just fired
 * (false -> true). Returns [] when:
 *  - there is no current event,
 *  - the current event is hard-blocked (l5Blocked or alertLevel L5), or
 *  - there is no prior baseline (prev null) — the first event of a stream only
 *    establishes the baseline and never pops a banner.
 */
export function deriveTriggerAlerts(
  prev: CopilotEvent | null | undefined,
  curr: CopilotEvent | null | undefined,
): TriggerAlert[] {
  if (!curr) return [];
  // A blocked / L5 read is never actionable — suppress all alerts.
  if (curr.l5Blocked || curr.alertLevel === "L5") return [];

  const fired = newlyFiredTriggers(prev?.triggers ?? null, curr.triggers);
  return fired.map((t) => ({
    name: t.name,
    category: t.category,
    detail: t.detail != null ? safeText(t.detail) : null,
    alertLevel: curr.alertLevel,
  }));
}
