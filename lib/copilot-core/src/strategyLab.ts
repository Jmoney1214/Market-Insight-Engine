// Strategy Lab registry — the deterministic source of truth for which trading
// hypotheses exist and how they are classified.
//
// SAFETY / HONESTY INVARIANT:
//   - "primary_edge" hypotheses are the only things that can ever be promoted to
//     a validated edge, and only via measured forward outcomes (see
//     edgeScoreboard.ts). Their presence here is just a *definition*; it confers
//     no credibility on its own.
//   - "entry_refinement" features (FVG / BOS / CHOCH / liquidity sweeps / VWAP
//     reclaims, etc.) are context only. They are NOT promotable. No amount of
//     journaling or hand-typed belief can turn folklore into a proven edge.
//
// This module is pure data + lookup helpers. It never imports the API/wire layer.

import type { TriggerCategory } from "./types";

/** A simplified, deterministic cost assumption attached to each hypothesis. */
export interface CostModel {
  commissionPerShare: number;
  slippageBps: number;
  spreadBps: number;
}

/** A registry definition for a hypothesis or an entry-refinement feature. */
export interface StrategyDefinition {
  hypothesisName: string;
  primaryEdgeType: string;
  category: TriggerCategory;
  /** Only true for primary-edge hypotheses. Refinement features are never promotable. */
  promotable: boolean;
  requiredData: string[];
  universe: string;
  setupConditions: string[];
  entryRefinementFeatures: string[];
  invalidationRules: string[];
  targetRules: string[];
  holdingPeriod: string;
  costModel: CostModel;
  /** Minimum measured sample count before a status above "insufficient" is meaningful. */
  minimumSampleCount: number;
  note: string | null;
}

const STANDARD_COST: CostModel = {
  commissionPerShare: 0.005,
  slippageBps: 2,
  spreadBps: 3,
};

/**
 * The seven initial primary-edge hypotheses. These are testable directional
 * hypotheses — never guarantees. Each must earn its validation status from
 * measured forward outcomes.
 */
export const PRIMARY_EDGE_HYPOTHESES: StrategyDefinition[] = [
  {
    hypothesisName: "POST_EARNINGS_DRIFT",
    primaryEdgeType: "event_drift",
    category: "primary_edge",
    promotable: true,
    requiredData: ["daily_ohlcv", "earnings_calendar", "relative_volume"],
    universe: "Liquid US large/mega-cap equities with a confirmed earnings date",
    setupConditions: [
      "Earnings released within the prior session",
      "Gap in the direction of the surprise holds through the opening range",
      "Relative volume elevated versus the 20-day average",
    ],
    entryRefinementFeatures: ["VWAP_reclaim", "ORB_retest"],
    invalidationRules: ["Close back through the prior-day close against the drift direction"],
    targetRules: ["Prior swing extreme", "Measured-move multiple of the opening range"],
    holdingPeriod: "1-5 sessions",
    costModel: STANDARD_COST,
    minimumSampleCount: 20,
    note: null,
  },
  {
    hypothesisName: "RELATIVE_STRENGTH_MOMENTUM",
    primaryEdgeType: "momentum",
    category: "primary_edge",
    promotable: true,
    requiredData: ["intraday_ohlcv", "index_benchmark", "vwap", "relative_volume"],
    universe: "Liquid US equities outperforming their sector/index intraday",
    setupConditions: [
      "Price holding above VWAP",
      "Outperforming the benchmark since the open",
      "Higher-low structure intact",
    ],
    entryRefinementFeatures: ["higher_low", "VWAP_reclaim"],
    invalidationRules: ["Loss of VWAP with a lower high", "Relative strength flips negative"],
    targetRules: ["Trail under structure", "Prior session high"],
    holdingPeriod: "Intraday to 2 sessions",
    costModel: STANDARD_COST,
    minimumSampleCount: 20,
    note: null,
  },
  {
    hypothesisName: "GAP_CONTINUATION",
    primaryEdgeType: "gap",
    category: "primary_edge",
    promotable: true,
    requiredData: ["intraday_ohlcv", "prior_session_close", "relative_volume"],
    universe: "Liquid US equities gapping on a catalyst",
    setupConditions: [
      "Gap holds above the opening range in the gap direction",
      "Volume expansion confirms participation",
    ],
    entryRefinementFeatures: ["ORB_retest", "VOLUME_EXPANSION"],
    invalidationRules: ["Full gap fill against the position"],
    targetRules: ["Measured move", "Next liquidity shelf"],
    holdingPeriod: "Intraday",
    costModel: STANDARD_COST,
    minimumSampleCount: 20,
    note: null,
  },
  {
    hypothesisName: "GAP_FADE",
    primaryEdgeType: "mean_reversion",
    category: "primary_edge",
    promotable: true,
    requiredData: ["intraday_ohlcv", "prior_session_close", "atr"],
    universe: "Liquid US equities gapping into prior supply/demand with no catalyst",
    setupConditions: [
      "Gap into a prior level with no confirming volume",
      "Opening range fails to extend the gap",
    ],
    entryRefinementFeatures: ["liquidity_sweep", "VWAP_loss"],
    invalidationRules: ["New extreme beyond the opening range in the gap direction"],
    targetRules: ["Prior session close (gap fill)", "VWAP"],
    holdingPeriod: "Intraday",
    costModel: STANDARD_COST,
    minimumSampleCount: 20,
    note: null,
  },
  {
    hypothesisName: "OPENING_RANGE_BREAKOUT",
    primaryEdgeType: "breakout",
    category: "primary_edge",
    promotable: true,
    requiredData: ["intraday_ohlcv", "opening_range", "relative_volume"],
    universe: "Liquid US equities with a definable opening range",
    setupConditions: [
      "Price breaks above the opening-range high",
      "Volume expands on the break",
    ],
    entryRefinementFeatures: ["VOLUME_EXPANSION", "ORB_retest"],
    invalidationRules: ["Reclaim back inside the opening range"],
    targetRules: ["Measured move of the opening range", "Prior session high"],
    holdingPeriod: "Intraday",
    costModel: STANDARD_COST,
    minimumSampleCount: 20,
    note: null,
  },
  {
    hypothesisName: "OPENING_RANGE_FAILURE",
    primaryEdgeType: "breakdown",
    category: "primary_edge",
    promotable: true,
    requiredData: ["intraday_ohlcv", "opening_range", "relative_volume"],
    universe: "Liquid US equities with a definable opening range",
    setupConditions: [
      "Price breaks below the opening-range low",
      "No reclaim on the retest",
    ],
    entryRefinementFeatures: ["VWAP_loss", "lower_high"],
    invalidationRules: ["Reclaim back inside the opening range"],
    targetRules: ["Measured move of the opening range", "Prior session low"],
    holdingPeriod: "Intraday",
    costModel: STANDARD_COST,
    minimumSampleCount: 20,
    note: null,
  },
  {
    hypothesisName: "VOLATILITY_COMPRESSION_BREAKOUT",
    primaryEdgeType: "volatility_expansion",
    category: "primary_edge",
    promotable: true,
    requiredData: ["intraday_ohlcv", "atr", "relative_volume"],
    universe: "Liquid US equities in a measurable volatility contraction",
    setupConditions: [
      "Range contraction versus recent ATR",
      "Expansion bar with volume out of the coil",
    ],
    entryRefinementFeatures: ["VOLUME_EXPANSION", "BOS"],
    invalidationRules: ["Re-entry into the contraction range"],
    targetRules: ["ATR-based measured move", "Next structural level"],
    holdingPeriod: "Intraday to 2 sessions",
    costModel: STANDARD_COST,
    minimumSampleCount: 20,
    note: null,
  },
];

const FOLKLORE_NOTE =
  "Entry-refinement context only — cannot become a proven edge regardless of how often it is journaled.";

function refinementFeature(name: string): StrategyDefinition {
  return {
    hypothesisName: name,
    primaryEdgeType: "entry_refinement",
    category: "entry_refinement",
    promotable: false,
    requiredData: ["intraday_ohlcv"],
    universe: "Context feature — applies within a primary-edge setup",
    setupConditions: [],
    entryRefinementFeatures: [],
    invalidationRules: [],
    targetRules: [],
    holdingPeriod: "n/a",
    costModel: STANDARD_COST,
    minimumSampleCount: 0,
    note: FOLKLORE_NOTE,
  };
}

/**
 * Entry-refinement features. These include popular "smart money" / ICT folklore
 * (liquidity sweeps, FVGs, BOS, CHOCH). They are deliberately non-promotable:
 * the scoreboard never scores them, so they can never be reported as a proven edge.
 */
export const ENTRY_REFINEMENT_FEATURES: StrategyDefinition[] = [
  "liquidity_sweep",
  "FVG",
  "BOS",
  "CHOCH",
  "higher_low",
  "lower_high",
  "VWAP_reclaim",
  "VWAP_loss",
  "ORB_retest",
  "VOLUME_EXPANSION",
].map(refinementFeature);

/** The full registry: primary-edge hypotheses followed by refinement features. */
export const STRATEGY_REGISTRY: StrategyDefinition[] = [
  ...PRIMARY_EDGE_HYPOTHESES,
  ...ENTRY_REFINEMENT_FEATURES,
];

const REGISTRY_BY_NAME = new Map(
  STRATEGY_REGISTRY.map((entry) => [entry.hypothesisName, entry]),
);

export function getStrategy(name: string): StrategyDefinition | undefined {
  return REGISTRY_BY_NAME.get(name);
}

/**
 * Map a (possibly directionalized) detector trigger name to its canonical
 * registry hypothesis name. Detectors emit directional variants such as
 * GAP_FADE_LONG or VOLATILITY_COMPRESSION_BREAKOUT_SHORT, but the registry,
 * scoreboard, and journaling all key off the directionless hypothesis
 * (GAP_FADE, VOLATILITY_COMPRESSION_BREAKOUT). Without this normalization a
 * journaled directional trigger would never match a registry entry and its
 * measured outcome would be silently dropped from the scoreboard.
 *
 * Returns the input unchanged when it already names a registry entry or when
 * stripping the direction suffix does not resolve to a known hypothesis.
 */
export function canonicalHypothesisName(name: string): string {
  if (REGISTRY_BY_NAME.has(name)) return name;
  const base = name.replace(/_(LONG|SHORT)$/, "");
  if (base !== name && REGISTRY_BY_NAME.has(base)) return base;
  return name;
}

export function isPrimaryEdge(name: string): boolean {
  return getStrategy(name)?.category === "primary_edge";
}

export function isEntryRefinement(name: string): boolean {
  return getStrategy(name)?.category === "entry_refinement";
}

/** A strategy can be promoted to a validated edge only if it is a promotable primary edge. */
export function isPromotable(name: string): boolean {
  return getStrategy(name)?.promotable === true;
}
