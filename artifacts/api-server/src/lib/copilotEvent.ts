import type { CopilotEvent as CoreCopilotEvent } from "@workspace/copilot-core";
import type { CopilotEvent as ApiCopilotEvent } from "@workspace/api-zod";

/**
 * Maps the deterministic core event onto the generated API wire type. Typing the
 * return as the generated {@link ApiCopilotEvent} makes the boundary explicit: if
 * the core output drifts from the OpenAPI contract, this fails to compile.
 */
export function coreEventToApiEvent(event: CoreCopilotEvent): ApiCopilotEvent {
  return {
    eventId: event.eventId,
    symbol: event.symbol,
    timestamp: event.timestamp,
    mode: event.mode,
    dataSource: event.dataSource,
    alertLevel: event.alertLevel,
    l5Blocked: event.l5Blocked,
    snapshot: { ...event.snapshot },
    marketQuality: { ...event.marketQuality },
    triggers: event.triggers.map((t) => ({
      name: t.name,
      category: t.category,
      detected: t.detected,
      detail: t.detail,
    })),
    triggerStack: {
      stackName: event.triggerStack.stackName,
      category: event.triggerStack.category,
      credibility: event.triggerStack.credibility,
      detectedTriggers: [...event.triggerStack.detectedTriggers],
    },
    gates: {
      data: { ...event.gates.data },
      staleness: { ...event.gates.staleness },
      spread: { ...event.gates.spread },
      marketQuality: { ...event.gates.marketQuality },
      credibility: { ...event.gates.credibility },
      validation: { ...event.gates.validation },
    },
    hardBlocks: [...event.hardBlocks],
    riskReward: { ...event.riskReward },
    position: { ...event.position },
    feedQuality: { ...event.feedQuality },
    warnings: [...event.warnings],
  };
}
