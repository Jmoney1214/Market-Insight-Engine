import { describe, it, expect } from "vitest";
import {
  modeToSampleKind,
  journalOutcomeToSample,
  computeEdgeScore,
  computeScoreboard,
  PRIMARY_EDGE_HYPOTHESES,
  getStrategy,
  type EdgeThresholds,
  type OutcomeConfidence,
  type SampleKind,
  type TradeSample,
} from "./index";

const STRAT = "OPENING_RANGE_BREAKOUT";
const DEF = getStrategy(STRAT)!;

const THRESHOLDS: EdgeThresholds = {
  minBacktestSample: 3,
  minForwardSample: 3,
  minExpectancyR: 0.1,
  minProfitFactor: 1.2,
  maxDrawdownRLimit: 5,
};

function sample(
  rMultiple: number,
  opts: Partial<TradeSample> = {},
): TradeSample {
  return {
    strategyName: STRAT,
    outcomeConfidence: "MANUAL_CONFIRMED",
    kind: "paper",
    rMultiple,
    mfeR: null,
    maeR: null,
    regime: null,
    timeWindow: null,
    timeToTargetBars: null,
    timeToStopBars: null,
    ...opts,
  };
}

describe("modeToSampleKind", () => {
  it("maps modes to the right sample bucket", () => {
    expect(modeToSampleKind("LIVE")).toBe("forward");
    expect(modeToSampleKind("REPLAY")).toBe("paper");
    expect(modeToSampleKind("RESEARCH")).toBe("backtest");
    expect(modeToSampleKind("anything-else")).toBe("backtest");
  });
});

describe("journalOutcomeToSample (whitelist extraction)", () => {
  it("parses a valid confirmed primary-edge outcome", () => {
    const s = journalOutcomeToSample({
      mode: "REPLAY",
      manualOutcome: {
        strategyName: STRAT,
        outcomeConfidence: "MANUAL_CONFIRMED",
        rMultiple: 1.5,
        action: "closed",
        regime: "trend",
        notes: "ignored prose",
      },
    });
    expect(s).not.toBeNull();
    expect(s!.kind).toBe("paper");
    expect(s!.rMultiple).toBe(1.5);
    expect(s!.regime).toBe("trend");
  });

  it("rejects entry-refinement folklore as a sample (anti-promotion)", () => {
    for (const folklore of ["FVG", "BOS", "CHOCH", "liquidity_sweep", "VOLUME_EXPANSION"]) {
      const s = journalOutcomeToSample({
        mode: "REPLAY",
        manualOutcome: {
          strategyName: folklore,
          outcomeConfidence: "MANUAL_CONFIRMED",
          rMultiple: 2,
          action: "closed",
        },
      });
      expect(s).toBeNull();
    }
  });

  it("rejects unknown strategy, bad confidence, non-finite R, and non-scoreable actions", () => {
    expect(
      journalOutcomeToSample({
        mode: "REPLAY",
        manualOutcome: { strategyName: "NOT_REAL", outcomeConfidence: "MANUAL_CONFIRMED", rMultiple: 1 },
      }),
    ).toBeNull();
    expect(
      journalOutcomeToSample({
        mode: "REPLAY",
        manualOutcome: { strategyName: STRAT, outcomeConfidence: "WHATEVER", rMultiple: 1 },
      }),
    ).toBeNull();
    expect(
      journalOutcomeToSample({
        mode: "REPLAY",
        manualOutcome: { strategyName: STRAT, outcomeConfidence: "MANUAL_CONFIRMED", rMultiple: "1.5" },
      }),
    ).toBeNull();
    expect(
      journalOutcomeToSample({
        mode: "REPLAY",
        manualOutcome: { strategyName: STRAT, outcomeConfidence: "WATCH_ONLY", rMultiple: 1, action: "watched" },
      }),
    ).toBeNull();
    expect(journalOutcomeToSample({ mode: "REPLAY", manualOutcome: null })).toBeNull();
    expect(journalOutcomeToSample({ mode: "REPLAY" })).toBeNull();
  });

  it("rejects a confirmed, finite-R, valid-strategy payload that omits a scoreable action", () => {
    // Integrity guard: a malformed or legacy API payload that looks otherwise
    // scoreable but carries no explicit close/tracked action must never count.
    expect(
      journalOutcomeToSample({
        mode: "REPLAY",
        manualOutcome: { strategyName: STRAT, outcomeConfidence: "MANUAL_CONFIRMED", rMultiple: 1.5 },
      }),
    ).toBeNull();
    // An unrecognized action value is likewise not whitelisted.
    expect(
      journalOutcomeToSample({
        mode: "REPLAY",
        manualOutcome: {
          strategyName: STRAT,
          outcomeConfidence: "MANUAL_CONFIRMED",
          rMultiple: 1.5,
          action: "executed_live",
        },
      }),
    ).toBeNull();
  });
});

describe("computeEdgeScore — math", () => {
  it("computes expectancy, win rate and drawdown", () => {
    const samples = [sample(2), sample(-1), sample(1), sample(-1)];
    const score = computeEdgeScore(DEF, samples, THRESHOLDS);
    expect(score.countableSampleCount).toBe(4);
    expect(score.expectancyR).toBeCloseTo(0.25, 5);
    expect(score.winRate).toBeCloseTo(0.5, 5);
    // profit factor = (2+1) / (1+1) = 1.5
    expect(score.profitFactor).toBeCloseTo(1.5, 5);
    // cumulative R: 2,1,2,1 -> peak 2, trough 1 -> max drawdown 1
    expect(score.maxDrawdownR).toBeCloseTo(1, 5);
  });

  it("only counts MANUAL_CONFIRMED outcomes; estimates/assumptions don't promote", () => {
    const nonCountables: OutcomeConfidence[] = [
      "MANUAL_ESTIMATED",
      "CURRENT_PRICE_ASSUMED",
      "WATCH_ONLY",
      "INVALID_SAMPLE",
    ];
    const samples = nonCountables.map((c, i) =>
      sample(2, { outcomeConfidence: c, kind: i % 2 === 0 ? "forward" : "paper" }),
    );
    const score = computeEdgeScore(DEF, samples, THRESHOLDS);
    expect(score.sampleCount).toBe(4);
    expect(score.countableSampleCount).toBe(0);
    expect(score.validationStatus).toBe("unproven");
    expect(score.expectancyR).toBeNull();
    expect(score.profitFactor).toBeNull();
  });

  it("sanitizes an all-winner profit factor to null but still recognizes the edge", () => {
    const samples = [
      sample(1, { kind: "forward" }),
      sample(2, { kind: "forward" }),
      sample(1, { kind: "paper" }),
    ];
    const score = computeEdgeScore(DEF, samples, THRESHOLDS);
    // no losses -> raw PF Infinity -> serialized null, but edge passes -> paper_validated
    expect(score.profitFactor).toBeNull();
    expect(score.maxDrawdownR).toBe(0);
    expect(score.validationStatus).toBe("paper_validated");
  });

  it("surfaces best/worst regime and time window buckets", () => {
    const samples = [
      sample(2, { regime: "trend", timeWindow: "open" }),
      sample(2, { regime: "trend", timeWindow: "open" }),
      sample(-1, { regime: "chop", timeWindow: "midday" }),
    ];
    const score = computeEdgeScore(DEF, samples, THRESHOLDS);
    expect(score.bestRegime).toBe("trend");
    expect(score.worstRegime).toBe("chop");
    expect(score.bestTimeWindow).toBe("open");
    expect(score.worstTimeWindow).toBe("midday");
  });
});

describe("computeEdgeScore — every validation status is reachable", () => {
  it("unproven when there are no countable samples", () => {
    expect(computeEdgeScore(DEF, [], THRESHOLDS).validationStatus).toBe("unproven");
  });

  it("insufficient_sample with only a few backtest samples below threshold", () => {
    const samples = [sample(2, { kind: "backtest" }), sample(1, { kind: "backtest" })];
    expect(computeEdgeScore(DEF, samples, THRESHOLDS).validationStatus).toBe("insufficient_sample");
  });

  it("paper_pending with some forward samples below threshold and no backtest edge", () => {
    const samples = [sample(2, { kind: "paper" }), sample(1, { kind: "forward" })];
    expect(computeEdgeScore(DEF, samples, THRESHOLDS).validationStatus).toBe("paper_pending");
  });

  it("backtested_only when backtest edge exists and there are zero forward samples", () => {
    const samples = [
      sample(1, { kind: "backtest" }),
      sample(2, { kind: "backtest" }),
      sample(1, { kind: "backtest" }),
    ];
    expect(computeEdgeScore(DEF, samples, THRESHOLDS).validationStatus).toBe("backtested_only");
  });

  it("backtested_pending_forward when backtest edge exists plus some (sub-threshold) forward", () => {
    const samples = [
      sample(1, { kind: "backtest" }),
      sample(2, { kind: "backtest" }),
      sample(1, { kind: "backtest" }),
      sample(1, { kind: "paper" }),
    ];
    expect(computeEdgeScore(DEF, samples, THRESHOLDS).validationStatus).toBe(
      "backtested_pending_forward",
    );
  });

  it("paper_validated when forward samples meet the threshold and show an edge", () => {
    const samples = [
      sample(1, { kind: "paper" }),
      sample(2, { kind: "forward" }),
      sample(1, { kind: "paper" }),
    ];
    expect(computeEdgeScore(DEF, samples, THRESHOLDS).validationStatus).toBe("paper_validated");
  });

  it("no_edge when sufficient forward samples fail thresholds", () => {
    const samples = [
      sample(-1, { kind: "paper" }),
      sample(-1, { kind: "forward" }),
      sample(-1, { kind: "paper" }),
    ];
    expect(computeEdgeScore(DEF, samples, THRESHOLDS).validationStatus).toBe("no_edge");
  });

  it("no_edge when sufficient backtest samples fail thresholds (negative evidence not hidden)", () => {
    const samples = [
      sample(-1, { kind: "backtest" }),
      sample(-1, { kind: "backtest" }),
      sample(-1, { kind: "backtest" }),
    ];
    expect(computeEdgeScore(DEF, samples, THRESHOLDS).validationStatus).toBe("no_edge");
  });
});

describe("computeScoreboard", () => {
  it("scores primary edges only and never returns refinement folklore", () => {
    const board = computeScoreboard([], THRESHOLDS);
    expect(board).toHaveLength(PRIMARY_EDGE_HYPOTHESES.length);
    const names = board.map((b) => b.hypothesisName);
    for (const folklore of ["FVG", "BOS", "CHOCH", "liquidity_sweep"]) {
      expect(names).not.toContain(folklore);
    }
    for (const row of board) {
      expect(row.validationStatus).toBe("unproven");
    }
  });

  it("attributes samples to the correct hypothesis", () => {
    const board = computeScoreboard(
      [sample(2, { kind: "forward" }), sample(1, { kind: "paper" }), sample(1, { kind: "forward" })],
      THRESHOLDS,
    );
    const orb = board.find((b) => b.hypothesisName === STRAT)!;
    expect(orb.validationStatus).toBe("paper_validated");
    const other = board.find((b) => b.hypothesisName !== STRAT)!;
    expect(other.countableSampleCount).toBe(0);
  });
});

// Type-only usage to keep SampleKind referenced/exported.
const _k: SampleKind = "forward";
void _k;
