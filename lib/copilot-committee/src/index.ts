// Public API for the read-only analyst committee.
//
// SAFETY: This package only explains the deterministic copilot event. It never
// creates signals, approves trades, overrides hard blocks, or invents data.

export * from "./vocab";
export * from "./types";

export {
  PROVIDER_PREFERENCE,
  selectProviderId,
  selectModelTier,
  type LlmProviderId,
  type ModelTier,
} from "./providerSelection";

export {
  clampConfidence,
  isApprovedRecommendation,
  scanForbidden,
  scanForbiddenDeep,
  hasForbiddenLanguage,
  extractNumbers,
  ungroundedNumbers,
  isHardBlocked,
  enforceHardBlock,
  applyRiskCeiling,
  validateAgentRead,
  validateDashboardRead,
} from "./guardrails";

export { runAgents, readsToArray } from "./agents";
export {
  SELECTABLE_LENSES,
  ALWAYS_RUN,
  validateLensSelection,
  type SelectableLens,
  type LensSelectionValidation,
} from "./lensRegistry";
export { synthesize } from "./synthesize";
export { runCommittee } from "./orchestrator";
export { safetyNetRead } from "./fallback";
export { createMockProvider } from "./mockProvider";
