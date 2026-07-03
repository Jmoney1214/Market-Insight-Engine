// Edge Scoreboard — deterministic measurement of whether a primary-edge
// hypothesis has demonstrated an edge from MEASURED outcomes.
//
// HONESTY INVARIANTS (enforced here, not by convention):
//   - Only "primary_edge" promotable hypotheses are ever scored. Entry-refinement
//     folklore is never returned, so it can never be reported as a proven edge.
//   - Only MANUAL_CONFIRMED outcomes count toward promotion. Estimated /
//     current-price-assumed / watch-only / invalid outcomes never promote.
//   - Backtest evidence can never substitute for forward (live/replay) samples:
//     "paper_validated" requires enough confirmed out-of-sample outcomes.
//   - All free-form journal text is ignored. Sample fields are whitelist-extracted
//     and numerically validated, so hand-typed prose cannot manufacture an edge.
//
// Pure module: no DB, no wire layer. The API server reads journal rows, maps them
// with journalOutcomeToSample(), then calls computeScoreboard().

import { sanitizeNumber } from "./sanitize";
import {
  PRIMARY_EDGE_HYPOTHESES,
  canonicalHypothesisName,
  getStrategy,
  type StrategyDefinition,
} from "./strategyLab";
import type { ValidationStatus } from "./types";

/** How confident the journaler is in the recorded outcome. Only the first promotes. */
export type OutcomeConfidence =
  | "MANUAL_CONFIRMED"
  | "MANUAL_ESTIMATED"
  | "CURRENT_PRICE_ASSUMED"
  | "WATCH_ONLY"
  | "INVALID_SAMPLE";

/** Where the sample came from. live/replay form the out-of-sample (forward) bucket. */
export type SampleKind = "forward" | "paper" | "backtest";

const OUTCOME_CONFIDENCES: ReadonlySet<string> = new Set<OutcomeConfidence>([
  "MANUAL_CONFIRMED",
  "MANUAL_ESTIMATED",
  "CURRENT_PRICE_ASSUMED",
  "WATCH_ONLY",
  "INVALID_SAMPLE",
]);

/** Journal actions that represent a measurable closed/tracked trade (vs. watch/skip). */
const SCOREABLE_ACTIONS: ReadonlySet<string> = new Set([
  "closed",
  "manually_tracked",
  "target_hit",
  "stop_hit",
]);

/** A single measured outcome attributable to one primary-edge hypothesis. */
export interface TradeSample {
  strategyName: string;
  outcomeConfidence: OutcomeConfidence;
  kind: SampleKind;
  rMultiple: number;
  mfeR: number | null;
  maeR: number | null;
  regime: string | null;
  timeWindow: string | null;
  timeToTargetBars: number | null;
  timeToStopBars: number | null;
}

export interface EdgeThresholds {
  minBacktestSample: number;
  /** Applies to the out-of-sample (live + replay) bucket. */
  minForwardSample: number;
  minExpectancyR: number;
  minProfitFactor: number;
  maxDrawdownRLimit: number;
}

export const DEFAULT_THRESHOLDS: EdgeThresholds = {
  minBacktestSample: 20,
  minForwardSample: 20,
  minExpectancyR: 0.1,
  minProfitFactor: 1.2,
  maxDrawdownRLimit: 8,
};

/** The computed scoreboard row for one primary-edge hypothesis. */
export interface EdgeScore {
  hypothesisName: string;
  primaryEdgeType: string;
  validationStatus: ValidationStatus;
  sampleCount: number;
  countableSampleCount: number;
  forwardSampleCount: number;
  paperSampleCount: number;
  backtestSampleCount: number;
  winRate: number | null;
  averageR: number | null;
  expectancyR: number | null;
  profitFactor: number | null;
  maxDrawdownR: number | null;
  avgMfeR: number | null;
  avgMaeR: number | null;
  avgTimeToTargetBars: number | null;
  avgTimeToStopBars: number | null;
  bestRegime: string | null;
  worstRegime: string | null;
  bestTimeWindow: string | null;
  worstTimeWindow: string | null;
  note: string | null;
}

function isOutcomeConfidence(value: string | null): value is OutcomeConfidence {
  return value !== null && OUTCOME_CONFIDENCES.has(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** REPLAY practice and LIVE observation form the out-of-sample bucket; RESEARCH is backtest. */
export function modeToSampleKind(mode: string): SampleKind {
  if (mode === "LIVE") return "forward";
  if (mode === "REPLAY") return "paper";
  return "backtest";
}

interface JournalLike {
  mode: string;
  manualOutcome?: unknown;
}

/**
 * Defensively turn a journal entry into a TradeSample, or null if it is not a
 * scoreable trade outcome. Everything is whitelist-validated; prose is ignored.
 */
export function journalOutcomeToSample(entry: JournalLike): TradeSample | null {
  const outcome = entry.manualOutcome;
  if (!outcome || typeof outcome !== "object") return null;
  const o = outcome as Record<string, unknown>;

  const rawStrategyName = nonEmptyString(o.strategyName);
  if (!rawStrategyName) return null;
  // Normalize directional detector names (GAP_FADE_LONG) to their registry
  // hypothesis (GAP_FADE) so the outcome matches a scoreboard row instead of
  // being silently dropped.
  const strategyName = canonicalHypothesisName(rawStrategyName);

  // Only promotable primary-edge hypotheses can ever produce a sample. This is
  // the structural guard that keeps entry-refinement folklore unprovable.
  const def = getStrategy(strategyName);
  if (!def || def.category !== "primary_edge" || !def.promotable) return null;

  const outcomeConfidence = nonEmptyString(o.outcomeConfidence);
  if (!isOutcomeConfidence(outcomeConfidence)) return null;

  const rMultiple = finiteNumber(o.rMultiple);
  if (rMultiple === null) return null;

  // A scoreable sample MUST carry an explicit whitelisted close/tracked action.
  // A missing action, a watch/skip/alert-quality action, or any other value
  // (e.g. a malformed or legacy API payload) never produces a sample. Integrity
  // is enforced here in deterministic core, never assumed from UI behavior.
  const action = nonEmptyString(o.action);
  if (action === null || !SCOREABLE_ACTIONS.has(action)) return null;

  return {
    strategyName,
    outcomeConfidence,
    kind: modeToSampleKind(entry.mode),
    rMultiple,
    mfeR: finiteNumber(o.mfeR),
    maeR: finiteNumber(o.maeR),
    regime: nonEmptyString(o.regime),
    timeWindow: nonEmptyString(o.timeWindow),
    timeToTargetBars: finiteNumber(o.timeToTargetBars),
    timeToStopBars: finiteNumber(o.timeToStopBars),
  };
}

interface RawMetrics {
  count: number;
  expectancyR: number;
  /** Infinity when there are no losing samples. */
  rawProfitFactor: number;
  /** Magnitude (>= 0) of the largest peak-to-trough decline in cumulative R. */
  maxDrawdownR: number;
  winRate: number;
}

function computeMetrics(samples: TradeSample[]): RawMetrics {
  const n = samples.length;
  if (n === 0) {
    return { count: 0, expectancyR: 0, rawProfitFactor: 0, maxDrawdownR: 0, winRate: 0 };
  }
  const rs = samples.map((s) => s.rMultiple);
  const total = rs.reduce((a, b) => a + b, 0);
  const wins = rs.filter((r) => r > 0);
  const sumPos = wins.reduce((a, b) => a + b, 0);
  const sumNeg = Math.abs(rs.filter((r) => r < 0).reduce((a, b) => a + b, 0));
  const rawProfitFactor =
    sumNeg === 0 ? (sumPos > 0 ? Infinity : 0) : sumPos / sumNeg;

  let cumulative = 0;
  let peak = 0;
  let maxDrawdownR = 0;
  for (const r of rs) {
    cumulative += r;
    if (cumulative > peak) peak = cumulative;
    const drawdown = peak - cumulative;
    if (drawdown > maxDrawdownR) maxDrawdownR = drawdown;
  }

  return {
    count: n,
    expectancyR: total / n,
    rawProfitFactor,
    maxDrawdownR,
    winRate: wins.length / n,
  };
}

/** Edge test on RAW metrics (before JSON sanitization) so infinite PF still passes. */
function hasEdge(metrics: RawMetrics, thresholds: EdgeThresholds): boolean {
  if (metrics.count === 0) return false;
  if (metrics.expectancyR < thresholds.minExpectancyR) return false;
  if (metrics.rawProfitFactor < thresholds.minProfitFactor) return false;
  if (metrics.maxDrawdownR > thresholds.maxDrawdownRLimit) return false;
  return true;
}

function bucketExtremes(
  samples: TradeSample[],
  key: "regime" | "timeWindow",
): { best: string | null; worst: string | null } {
  const groups = new Map<string, number[]>();
  for (const s of samples) {
    const bucket = s[key];
    if (!bucket) continue;
    const list = groups.get(bucket);
    if (list) list.push(s.rMultiple);
    else groups.set(bucket, [s.rMultiple]);
  }
  let best: string | null = null;
  let worst: string | null = null;
  let bestMean = -Infinity;
  let worstMean = Infinity;
  for (const [bucket, rs] of groups) {
    const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
    if (mean > bestMean) {
      bestMean = mean;
      best = bucket;
    }
    if (mean < worstMean) {
      worstMean = mean;
      worst = bucket;
    }
  }
  return { best, worst };
}

function averageOf(values: (number | null)[]): number | null {
  const xs = values.filter((v): v is number => v !== null);
  if (xs.length === 0) return null;
  return sanitizeNumber(xs.reduce((a, b) => a + b, 0) / xs.length);
}

function statusNote(
  status: ValidationStatus,
  outOfSampleCount: number,
  backtestCount: number,
  thresholds: EdgeThresholds,
): string | null {
  switch (status) {
    case "unproven":
      return "No confirmed outcomes recorded yet.";
    case "insufficient_sample":
      return `Insufficient confirmed samples (have ${backtestCount} backtest, ${outOfSampleCount} forward).`;
    case "paper_pending":
      return `Replay/practice samples building: ${outOfSampleCount}/${thresholds.minForwardSample} confirmed.`;
    case "backtested_only":
      return "Backtest edge present; no confirmed forward samples yet.";
    case "backtested_pending_forward":
      return `Backtest edge present; forward samples ${outOfSampleCount}/${thresholds.minForwardSample}.`;
    case "paper_validated":
      return "Edge confirmed on replay/practice samples.";
    case "no_edge":
      return "Measured samples do not meet edge thresholds.";
    default:
      return null;
  }
}

/** Compute the scoreboard row for a single primary-edge hypothesis. */
export function computeEdgeScore(
  strategy: StrategyDefinition,
  allSamples: TradeSample[],
  thresholds: EdgeThresholds = DEFAULT_THRESHOLDS,
): EdgeScore {
  const mine = allSamples.filter((s) => s.strategyName === strategy.hypothesisName);
  const countable = mine.filter((s) => s.outcomeConfidence === "MANUAL_CONFIRMED");
  const outOfSample = countable.filter(
    (s) => s.kind === "forward" || s.kind === "paper",
  );
  const backtest = countable.filter((s) => s.kind === "backtest");

  const overall = computeMetrics(countable);
  const oosMetrics = computeMetrics(outOfSample);
  const btMetrics = computeMetrics(backtest);

  let status: ValidationStatus;
  if (countable.length === 0) {
    status = "unproven";
  } else if (outOfSample.length >= thresholds.minForwardSample) {
    status = hasEdge(oosMetrics, thresholds) ? "paper_validated" : "no_edge";
  } else if (backtest.length >= thresholds.minBacktestSample) {
    status = hasEdge(btMetrics, thresholds)
      ? outOfSample.length > 0
        ? "backtested_pending_forward"
        : "backtested_only"
      : "no_edge";
  } else if (outOfSample.length > 0) {
    status = "paper_pending";
  } else {
    status = "insufficient_sample";
  }

  const regime = bucketExtremes(countable, "regime");
  const timeWindow = bucketExtremes(countable, "timeWindow");
  const has = countable.length > 0;

  return {
    hypothesisName: strategy.hypothesisName,
    primaryEdgeType: strategy.primaryEdgeType,
    validationStatus: status,
    sampleCount: mine.length,
    countableSampleCount: countable.length,
    forwardSampleCount: outOfSample.filter((s) => s.kind === "forward").length,
    paperSampleCount: outOfSample.filter((s) => s.kind === "paper").length,
    backtestSampleCount: backtest.length,
    winRate: has ? sanitizeNumber(overall.winRate) : null,
    averageR: has ? sanitizeNumber(overall.expectancyR) : null,
    expectancyR: has ? sanitizeNumber(overall.expectancyR) : null,
    profitFactor: has ? sanitizeNumber(overall.rawProfitFactor) : null,
    maxDrawdownR: has ? sanitizeNumber(overall.maxDrawdownR) : null,
    avgMfeR: averageOf(countable.map((s) => s.mfeR)),
    avgMaeR: averageOf(countable.map((s) => s.maeR)),
    avgTimeToTargetBars: averageOf(countable.map((s) => s.timeToTargetBars)),
    avgTimeToStopBars: averageOf(countable.map((s) => s.timeToStopBars)),
    bestRegime: regime.best,
    worstRegime: regime.worst,
    bestTimeWindow: timeWindow.best,
    worstTimeWindow: timeWindow.worst,
    note: statusNote(status, outOfSample.length, backtest.length, thresholds),
  };
}

/**
 * Compute the full scoreboard. Iterates PRIMARY-EDGE hypotheses only; refinement
 * features are never scored and therefore can never be reported as a proven edge.
 */
export function computeScoreboard(
  samples: TradeSample[],
  thresholds: EdgeThresholds = DEFAULT_THRESHOLDS,
): EdgeScore[] {
  return PRIMARY_EDGE_HYPOTHESES.map((strategy) =>
    computeEdgeScore(strategy, samples, thresholds),
  );
}
