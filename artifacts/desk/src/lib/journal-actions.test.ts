import { describe, it, expect } from "vitest";
import {
  MANUAL_ACTIONS,
  buildManualActionOutcome,
  buildCloseOutcome,
} from "./journal-actions";

// The server only counts these action keys toward the edge scoreboard.
const SCOREABLE_ACTIONS = new Set([
  "closed",
  "manually_tracked",
  "target_hit",
  "stop_hit",
]);

describe("buildManualActionOutcome", () => {
  it("maps every known action to its confidence", () => {
    for (const action of MANUAL_ACTIONS) {
      const outcome = buildManualActionOutcome(action.key);
      expect(outcome).toEqual({
        action: action.key,
        outcomeConfidence: action.outcomeConfidence,
      });
    }
  });

  it("never emits a scoreable action key (annotations cannot manufacture edge)", () => {
    for (const action of MANUAL_ACTIONS) {
      expect(SCOREABLE_ACTIONS.has(action.key)).toBe(false);
    }
  });

  it("returns null for an unknown action", () => {
    expect(buildManualActionOutcome("nonsense")).toBeNull();
  });
});

describe("buildCloseOutcome", () => {
  it("requires a strategy name", () => {
    expect(
      buildCloseOutcome({ strategyName: "", rMultiple: 1.5, confirmed: true }),
    ).toBeNull();
    expect(
      buildCloseOutcome({ strategyName: null, rMultiple: 1.5, confirmed: true }),
    ).toBeNull();
  });

  it("requires a finite R multiple", () => {
    expect(
      buildCloseOutcome({ strategyName: "GAP_FADE", rMultiple: "", confirmed: true }),
    ).toBeNull();
    expect(
      buildCloseOutcome({ strategyName: "GAP_FADE", rMultiple: "abc", confirmed: true }),
    ).toBeNull();
    expect(
      buildCloseOutcome({ strategyName: "GAP_FADE", rMultiple: null, confirmed: true }),
    ).toBeNull();
  });

  it("coerces a string R and marks confirmed fills MANUAL_CONFIRMED", () => {
    const outcome = buildCloseOutcome({
      strategyName: "OPENING_RANGE_BREAKOUT",
      rMultiple: "2.5",
      confirmed: true,
      direction: "LONG",
    });
    expect(outcome).toEqual({
      action: "closed",
      strategyName: "OPENING_RANGE_BREAKOUT",
      rMultiple: 2.5,
      outcomeConfidence: "MANUAL_CONFIRMED",
      direction: "LONG",
    });
  });

  it("downgrades unconfirmed closes to CURRENT_PRICE_ASSUMED (never promotes)", () => {
    const outcome = buildCloseOutcome({
      strategyName: "GAP_FADE",
      rMultiple: -1,
      confirmed: false,
    });
    expect(outcome?.outcomeConfidence).toBe("CURRENT_PRICE_ASSUMED");
    expect(outcome?.rMultiple).toBe(-1);
    expect(outcome?.direction).toBeUndefined();
  });
});
