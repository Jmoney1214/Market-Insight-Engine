import { describe, expect, it } from "vitest";
import type { CopilotEvent, CopilotTrigger } from "@workspace/api-client-react";
import { deriveTriggerAlerts } from "./trigger-alerts";

const trigger = (
  name: string,
  detected: boolean,
  category: CopilotTrigger["category"] = "primary_edge",
  detail: string | null = null,
): CopilotTrigger => ({ name, category, detected, detail });

// Minimal event factory — only the fields deriveTriggerAlerts reads matter.
function evt(
  overrides: Partial<CopilotEvent> & { triggers: CopilotTrigger[] },
): CopilotEvent {
  return {
    eventId: "e1",
    alertLevel: "L3",
    l5Blocked: false,
    ...overrides,
  } as CopilotEvent;
}

describe("deriveTriggerAlerts", () => {
  it("returns nothing when there is no current event", () => {
    expect(deriveTriggerAlerts(null, null)).toEqual([]);
    expect(deriveTriggerAlerts(null, undefined)).toEqual([]);
  });

  it("establishes a baseline with no alerts when there is no prior event", () => {
    const curr = evt({ triggers: [trigger("A", true)] });
    expect(deriveTriggerAlerts(null, curr)).toEqual([]);
  });

  it("alerts on a false -> true transition", () => {
    const prev = evt({ triggers: [trigger("A", false)] });
    const curr = evt({ triggers: [trigger("A", true)] });
    const alerts = deriveTriggerAlerts(prev, curr);
    expect(alerts.map((a) => a.name)).toEqual(["A"]);
  });

  it("debounces a trigger that stays detected across events", () => {
    const prev = evt({ triggers: [trigger("A", true)] });
    const curr = evt({ triggers: [trigger("A", true)] });
    expect(deriveTriggerAlerts(prev, curr)).toEqual([]);
  });

  it("does not alert when a trigger turns off", () => {
    const prev = evt({ triggers: [trigger("A", true)] });
    const curr = evt({ triggers: [trigger("A", false)] });
    expect(deriveTriggerAlerts(prev, curr)).toEqual([]);
  });

  it("suppresses all alerts when the current event is l5Blocked", () => {
    const prev = evt({ triggers: [trigger("A", false)] });
    const curr = evt({ triggers: [trigger("A", true)], l5Blocked: true });
    expect(deriveTriggerAlerts(prev, curr)).toEqual([]);
  });

  it("suppresses all alerts when the current event is alertLevel L5", () => {
    const prev = evt({ triggers: [trigger("A", false)] });
    const curr = evt({ triggers: [trigger("A", true)], alertLevel: "L5" });
    expect(deriveTriggerAlerts(prev, curr)).toEqual([]);
  });

  it("carries category and runs detail through the safety layer", () => {
    const prev = evt({ triggers: [trigger("CTX", false, "entry_refinement")] });
    const curr = evt({
      triggers: [
        trigger("CTX", true, "entry_refinement", "Higher low confirmed."),
      ],
    });
    const alerts = deriveTriggerAlerts(prev, curr);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].category).toBe("entry_refinement");
    expect(alerts[0].detail).toBe("Higher low confirmed.");
    expect(alerts[0].alertLevel).toBe("L3");
  });

  it("redacts forbidden language from detail before it can render", () => {
    const prev = evt({ triggers: [trigger("A", false)] });
    const curr = evt({
      triggers: [trigger("A", true, "primary_edge", "buy now and go long")],
    });
    const alerts = deriveTriggerAlerts(prev, curr);
    expect(alerts[0].detail).not.toMatch(/buy now/i);
  });
});
