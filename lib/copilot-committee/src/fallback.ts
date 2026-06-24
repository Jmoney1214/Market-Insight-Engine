// Hard safety-net read. Used only if the deterministic synthesizer output ever
// fails its own validation, or if a final forbidden-language sweep trips. It is
// guaranteed clean and conservative.

import type { CopilotEvent } from "@workspace/copilot-core";
import type { DashboardRead } from "./types";
import type { Recommendation } from "./vocab";
import { isHardBlocked } from "./guardrails";

export function safetyNetRead(event: CopilotEvent): DashboardRead {
  const inPosition = event.position.status === "IN_POSITION";
  const recommendation: Recommendation = isHardBlocked(event)
    ? inPosition
      ? "EXIT_WARNING"
      : "AVOID"
    : "WAIT";

  return {
    oneSentenceRead: `${event.symbol}: deterministic safety read only.`,
    recommendation,
    confidence: 0.5,
    whatSupports: [],
    whatArguesAgainst: [],
    whatConfirms: [],
    whatInvalidates: [],
    positionGuidance: inPosition
      ? ["Manage existing risk against your predefined plan."]
      : ["Stand aside until conditions are clearer."],
    riskNotes: [
      "Research/helper output only — not an order, signal, or instruction to transact.",
    ],
  };
}
