// Public API for the deterministic copilot core.

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
} from "./triggers";

export { evaluateGates } from "./gates";
export type { GateResult } from "./gates";

export { computeRiskReward } from "./riskReward";
export { evaluatePosition } from "./position";
export { computeFeedQuality } from "./feedQuality";
export { sanitizeDeep, sanitizeNumber } from "./sanitize";
export { atr, mean, sum, round, trueRange, highest, lowest } from "./detectors";

export { FIXTURES, getFixture, listFixtures } from "./fixtures";
export type { Fixture } from "./fixtures";

export {
  REPLAY_DATA_SOURCE,
  getReplaySession,
  buildReplayInput,
} from "./replay";
export type { ReplaySession } from "./replay";
