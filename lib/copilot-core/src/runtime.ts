// Fixture-free public API for production LIVE graphs. Historical fixtures and
// replay helpers remain available only from the package root for tests and the
// future canonical-case adapter; production surfaces must import this subpath.

export * from "./types";
export * from "./constants";

export { buildCopilotEvent } from "./event";
export {
  computeFeatures,
  computeVwap,
  computeRvol,
  computeOpeningRange,
  computeSpreadBps,
  classifyPriceLocation,
} from "./features";
export {
  detectTriggers,
  buildTriggerStack,
  inferDirection,
  newlyFiredTriggers,
} from "./triggers";
export { evaluateGates } from "./gates";
export type { GateResult } from "./gates";
export { computeRiskReward } from "./riskReward";
export { evaluatePosition } from "./position";
export { computeFeedQuality } from "./feedQuality";
export { sanitizeDeep, sanitizeNumber } from "./sanitize";
export {
  atr,
  mean,
  sum,
  round,
  trueRange,
  highest,
  lowest,
  swingHighs,
  swingLows,
  lastSwingHigh,
  lastSwingLow,
} from "./detectors";
export type { SwingPoint } from "./detectors";
export {
  PRIMARY_EDGE_HYPOTHESES,
  ENTRY_REFINEMENT_FEATURES,
  STRATEGY_REGISTRY,
  getStrategy,
  canonicalHypothesisName,
  isPrimaryEdge,
  isEntryRefinement,
  isPromotable,
} from "./strategyLab";
export type { StrategyDefinition, CostModel } from "./strategyLab";
export {
  DEFAULT_THRESHOLDS,
  modeToSampleKind,
  journalOutcomeToSample,
  computeEdgeScore,
  computeScoreboard,
} from "./edgeScoreboard";
export type {
  OutcomeConfidence,
  SampleKind,
  TradeSample,
  EdgeThresholds,
  EdgeScore,
} from "./edgeScoreboard";
