// Deterministic entry / invalidation / target preview.
//
// This is a research-only structural preview for study and journaling. It is
// not a recommendation, instruction, or signal to transact.

import { MIN_RR_RATIO, TARGET_R_MULTIPLE } from "./constants";
import { round } from "./detectors";
import type { Direction, Features, RiskReward } from "./types";

const BASE_NOTE = "Research-only structural preview for study and journaling.";

export function computeRiskReward(
  features: Features,
  direction: Direction | null,
): RiskReward {
  const { price, atr, openingRangeHigh, openingRangeLow } = features;

  if (direction === null || price === null || atr === null) {
    return {
      direction,
      entry: null,
      invalidation: null,
      target: null,
      ratio: null,
      riskPerShare: null,
      notes: `${BASE_NOTE} Insufficient data for a structured preview.`,
    };
  }

  // LONG-ONLY: direction is always LONG here (the null case returned above).
  // The stop sits below the entry. For a normal long, the opening-range LOW is
  // the structural support. For an INVERTED long — price broke BELOW the range
  // (a bearish signal bought as a long) — the range is above the entry and
  // gives no support below, so we MIRROR the upper structure (the opening-range
  // HIGH distance) below the entry. Without this, every inverted trade silently
  // collapsed to the ATR stop.
  const entry = round(price, 4);
  const brokeBelowRange = openingRangeLow !== null && entry < openingRangeLow;
  const structural = brokeBelowRange
    ? openingRangeHigh !== null
      ? entry - (openingRangeHigh - entry) // mirror the upper structure below
      : entry - atr
    : (openingRangeLow ?? entry - atr);
  const invalidation = round(Math.min(structural, entry - atr), 4);

  const riskPerShare = round(Math.abs(entry - invalidation), 4);
  if (riskPerShare <= 0) {
    return {
      direction,
      entry,
      invalidation,
      target: null,
      ratio: null,
      riskPerShare: null,
      notes: `${BASE_NOTE} Risk distance is degenerate; no target projected.`,
    };
  }

  const target = round(entry + TARGET_R_MULTIPLE * riskPerShare, 4);
  const ratio = round(Math.abs(target - entry) / riskPerShare, 2);
  const suffix =
    ratio < MIN_RR_RATIO ? " Reward-to-risk is below the preferred threshold." : "";

  return {
    direction,
    entry,
    invalidation,
    target,
    ratio,
    riskPerShare,
    notes: `${BASE_NOTE}${suffix}`,
  };
}
