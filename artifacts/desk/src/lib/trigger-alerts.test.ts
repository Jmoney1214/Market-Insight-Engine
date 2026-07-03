import { describe, expect, it } from "vitest";
import type { CopilotEvent, CopilotTrigger } from "@workspace/api-client-react";
import { deriveTriggerAlerts, eventAlertSignature } from "./trigger-alerts";

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

describe("eventAlertSignature", () => {
  it("is null for a missing event", () => {
    expect(eventAlertSignature(null)).toBeNull();
    expect(eventAlertSignature(undefined)).toBeNull();
  });

  it("stays stable across identical polls (same eventId, same detected set)", () => {
    const a = evt({ eventId: "bar1", triggers: [trigger("A", false)] });
    const b = evt({ eventId: "bar1", triggers: [trigger("A", false)] });
    expect(eventAlertSignature(a)).toBe(eventAlertSignature(b));
  });

  it("changes on an intrabar flip (same eventId, changed detected set)", () => {
    const before = evt({ eventId: "bar1", triggers: [trigger("A", false)] });
    const after = evt({ eventId: "bar1", triggers: [trigger("A", true)] });
    expect(eventAlertSignature(before)).not.toBe(eventAlertSignature(after));
  });

  it("is independent of trigger ordering", () => {
    const a = evt({
      eventId: "bar1",
      triggers: [trigger("A", true), trigger("B", false)],
    });
    const b = evt({
      eventId: "bar1",
      triggers: [trigger("B", false), trigger("A", true)],
    });
    expect(eventAlertSignature(a)).toBe(eventAlertSignature(b));
  });
});

// Simulates the hook's signature-keyed dedupe guard to prove an intrabar flip
// (same eventId, changed detected set) produces exactly one alert while
// identical polls are skipped and a still-detected trigger is debounced.
describe("intrabar dedupe (signature-guarded baseline advance)", () => {
  function runStream(events: CopilotEvent[]): string[][] {
    let prevEvent: CopilotEvent | null = null;
    let lastSignature: string | null = null;
    const pushed: string[][] = [];
    for (const event of events) {
      const signature = eventAlertSignature(event);
      if (lastSignature === signature) continue;
      const alerts = deriveTriggerAlerts(prevEvent, event);
      if (alerts.length > 0) pushed.push(alerts.map((a) => a.name));
      prevEvent = event;
      lastSignature = signature;
    }
    return pushed;
  }

  it("fires exactly one alert on an intrabar false -> true flip within the same bar", () => {
    const pushed = runStream([
      // Baseline poll for bar1: trigger off.
      evt({ eventId: "bar1", triggers: [trigger("A", false)] }),
      // Identical re-poll — skipped by the signature guard.
      evt({ eventId: "bar1", triggers: [trigger("A", false)] }),
      // Intrabar flip on the SAME bar: trigger fires -> exactly one alert.
      evt({ eventId: "bar1", triggers: [trigger("A", true)] }),
      // Still detected on the same bar — debounced, no repeat banner.
      evt({ eventId: "bar1", triggers: [trigger("A", true)] }),
    ]);
    expect(pushed).toEqual([["A"]]);
  });

  it("suppresses the intrabar flip when the read becomes l5Blocked", () => {
    const pushed = runStream([
      evt({ eventId: "bar1", triggers: [trigger("A", false)] }),
      evt({ eventId: "bar1", triggers: [trigger("A", true)], l5Blocked: true }),
    ]);
    expect(pushed).toEqual([]);
  });
});
