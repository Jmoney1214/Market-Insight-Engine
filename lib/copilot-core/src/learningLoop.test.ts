// The learning loop, proven end to end:
//   registry mapping → journal sample creation → edge statistics → status change.
//
// Written failing-first against the architecture break edge-curator found: the
// shipped rider/scalper engines had no registry hypothesis, so their journaled
// outcomes were silently dropped by journalOutcomeToSample() and could never
// count toward validation. No registry ID = no learning.

import { describe, it, expect } from "vitest";
import {
  PRIMARY_EDGE_HYPOTHESES,
  getStrategy,
} from "./strategyLab";
import {
  computeScoreboard,
  journalOutcomeToSample,
} from "./edgeScoreboard";

/** The badge classes the shipped engines actually trade. */
const ENGINE_HYPOTHESES = ["JUMPDAY_RIDER", "LARGECAP_SCALPER"] as const;

function outcome(strategyName: string, rMultiple: number) {
  return {
    mode: "LIVE",
    manualOutcome: {
      strategyName,
      outcomeConfidence: "MANUAL_CONFIRMED",
      rMultiple,
      action: "closed",
    },
  };
}

describe("registry coverage — every shipped engine maps to a strategyId", () => {
  it.each(ENGINE_HYPOTHESES)("%s exists, promotable, primary_edge", (name) => {
    const def = getStrategy(name);
    expect(def, `${name} missing from STRATEGY_REGISTRY`).toBeTruthy();
    expect(def!.category).toBe("primary_edge");
    expect(def!.promotable).toBe(true);
    expect(def!.minimumSampleCount).toBeGreaterThanOrEqual(20);
  });

  it.each(ENGINE_HYPOTHESES)("%s has a scoreboard row", (name) => {
    expect(PRIMARY_EDGE_HYPOTHESES.map((h) => h.hypothesisName)).toContain(name);
    const row = computeScoreboard([]).find((s) => s.hypothesisName === name);
    expect(row).toBeTruthy();
    expect(row!.validationStatus).toBe("unproven");
  });
});

describe("journal persistence — engine outcomes are never silently dropped", () => {
  it.each(ENGINE_HYPOTHESES)("%s outcome becomes a countable sample", (name) => {
    const sample = journalOutcomeToSample(outcome(name, 1.5));
    expect(sample, `${name} was dropped by journalOutcomeToSample`).not.toBeNull();
    expect(sample!.strategyName).toBe(name);
    expect(sample!.kind).toBe("forward");
  });

  it("directional suffixes normalize to the engine hypothesis", () => {
    const sample = journalOutcomeToSample(outcome("JUMPDAY_RIDER_LONG", 1.2));
    expect(sample).not.toBeNull();
    expect(sample!.strategyName).toBe("JUMPDAY_RIDER");
  });

  it("non-registry names still drop (folklore stays unprovable)", () => {
    expect(journalOutcomeToSample(outcome("FVG", 2))).toBeNull();
    expect(journalOutcomeToSample(outcome("MADE_UP_EDGE", 2))).toBeNull();
  });
});

describe("learning readback — outcomes change future status, not vibes", () => {
  const losers = Array.from({ length: 20 }, () =>
    journalOutcomeToSample(outcome("JUMPDAY_RIDER", -1))!,
  );
  const winners = Array.from({ length: 20 }, () =>
    journalOutcomeToSample(outcome("JUMPDAY_RIDER", 1.5))!,
  );

  it("20 confirmed losers → no_edge (the system learns it does NOT work)", () => {
    const row = computeScoreboard(losers).find(
      (s) => s.hypothesisName === "JUMPDAY_RIDER",
    )!;
    expect(row.sampleCount).toBe(20);
    expect(row.validationStatus).toBe("no_edge");
    expect(row.expectancyR).toBeLessThan(0);
  });

  it("20 confirmed winners → paper_validated (and only at the threshold)", () => {
    const row = computeScoreboard(winners).find(
      (s) => s.hypothesisName === "JUMPDAY_RIDER",
    )!;
    expect(row.validationStatus).toBe("paper_validated");
    // 19 is not enough — validation is earned at the sample floor, never early
    const row19 = computeScoreboard(winners.slice(0, 19)).find(
      (s) => s.hypothesisName === "JUMPDAY_RIDER",
    )!;
    expect(row19.validationStatus).toBe("paper_pending");
  });

  it("losses poison a winning record (mixed outcomes re-grade honestly)", () => {
    const mixed = [...winners.slice(0, 6), ...losers.slice(0, 14)];
    const row = computeScoreboard(mixed).find(
      (s) => s.hypothesisName === "JUMPDAY_RIDER",
    )!;
    expect(row.validationStatus).toBe("no_edge");
  });
});
