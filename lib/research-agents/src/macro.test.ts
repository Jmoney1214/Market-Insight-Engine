import { describe, it, expect } from "vitest";
import { buildMacroContext, pickVintage, shouldRunMacro, type MacroCalendarEvent } from "./macro";

const NOW = "2026-07-13T09:15:00-04:00";

const cpi: MacroCalendarEvent = {
  eventType: "CPI",
  scheduledTime: "2026-07-14T08:30:00-04:00", // tomorrow, inside 24h window
  reportedValue: null,
  consensusValue: 2.6,
  unit: "PERCENT_YOY",
  revisionStatus: "UNKNOWN",
  sourceDocumentId: null,
};

describe("shouldRunMacro (deterministic trigger router)", () => {
  it("triggers inside a release window", () => {
    const t = shouldRunMacro({ now: NOW, calendar: [cpi], indexMovePct: 0.2 });
    expect(t.required).toBe(true);
    expect(t.triggerReasonCodes).toEqual(["CPI_RELEASE_WINDOW"]);
    expect(t.activeEvents).toHaveLength(1);
  });

  it("does not trigger outside every window with a quiet tape", () => {
    const far = { ...cpi, scheduledTime: "2026-08-01T08:30:00-04:00" };
    const t = shouldRunMacro({ now: NOW, calendar: [far], indexMovePct: 0.2 });
    expect(t.required).toBe(false);
    expect(t.activeEvents).toEqual([]);
  });

  it("triggers on index-move threshold alone", () => {
    const t = shouldRunMacro({ now: NOW, calendar: [], indexMovePct: -1.7 });
    expect(t.required).toBe(true);
    expect(t.triggerReasonCodes).toEqual(["INDEX_MOVE_THRESHOLD"]);
  });

  it("unknown index move never triggers by itself", () => {
    expect(shouldRunMacro({ now: NOW, calendar: [], indexMovePct: null }).required).toBe(false);
  });
});

describe("pickVintage", () => {
  it("keeps the most authoritative vintage per event type — never blends", () => {
    const prelim = { ...cpi, revisionStatus: "PRELIMINARY" as const, reportedValue: 2.5 };
    const final = { ...cpi, revisionStatus: "FINAL" as const, reportedValue: 2.7 };
    const picked = pickVintage([prelim, final]);
    expect(picked).toHaveLength(1);
    expect(picked[0]!.reportedValue).toBe(2.7);
  });
});

describe("buildMacroContext", () => {
  it("not required → explicitly empty context (RETURN_NOT_REQUIRED shape)", () => {
    const trigger = shouldRunMacro({ now: NOW, calendar: [], indexMovePct: 0.1 });
    const ctx = buildMacroContext({ macroContextId: "m1", trigger, now: NOW });
    expect(ctx.required).toBe(false);
    expect(ctx.activeEvents).toEqual([]);
    expect(ctx.tickerSensitivity).toBe("UNKNOWN");
    expect(ctx.causalConfidence).toBe("UNKNOWN");
  });

  it("required → carries active events and caller-provided sensitivity", () => {
    const trigger = shouldRunMacro({ now: NOW, calendar: [cpi], indexMovePct: null });
    const ctx = buildMacroContext({
      macroContextId: "m2",
      trigger,
      tickerSensitivity: "POSSIBLE",
      causalConfidence: "LOW",
      now: NOW,
    });
    expect(ctx.required).toBe(true);
    expect(ctx.activeEvents).toHaveLength(1);
    expect(ctx.tickerSensitivity).toBe("POSSIBLE");
  });
});
