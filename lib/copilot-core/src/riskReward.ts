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
  // A bearish structural signal reaches this path already INVERTED into a long
  // (triggers.ts inferDirection), so the preview is a long entry with a stop
  // below structure and a target above — the mirrored risk of the raw signal.
  const entry = round(price, 4);
  const structural = openingRangeLow ?? entry - atr;
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
