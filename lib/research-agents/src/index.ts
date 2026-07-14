// Public API for the Wave 2 research agents. LLM providers are always
// INJECTED interfaces — this package never imports an AI SDK, and every
// decision field is computed by deterministic code.
export {
  SPECIALIST_TOOLS,
  ResearchMode,
  ResearchPlan,
  ResearchPlanStep,
  validateResearchPlan,
  topoOrder,
  defaultPlan,
  type SpecialistTool,
  type PlanValidation,
} from "./plan";
export {
  NINE_QUESTIONS,
  NarratedCatalyst,
  computeChecks,
  decideVerificationStatus,
  deterministicEventType,
  verifyCatalyst,
  type CatalystEvidence,
  type CatalystNarrator,
  type DeterministicChecks,
  type NewsClusterEvidence,
  type VerifyCatalystInput,
} from "./catalystVerifier";
export { resolveContest, type ContestResult } from "./contest";
export {
  EntailmentVerdict,
  auditClaim,
  admittedClaims,
  independentSourceCount,
  numericConsistent,
  type AuditClaimInput,
  type AuditedClaim,
  type EntailmentProvider,
} from "./sourceGuardian";
export {
  SentimentScore,
  bandFromScore,
  coverageCap,
  readSentiment,
  type GroundedBlock,
  type ReadSentimentInput,
  type SentimentProvider,
} from "./sentiment";
export {
  pickVintage,
  shouldRunMacro,
  buildMacroContext,
  type MacroCalendarEvent,
  type MacroTrigger,
  type MacroTriggerInput,
} from "./macro";
export {
  classifyLifecycle,
  extractSharesOutstanding,
  buildCapitalStructure,
  type FilingSummary,
  type LifecycleDecision,
  type LifecycleInput,
} from "./dilution";
export {
  runLead,
  planShapeHash,
  type LeadCheckpoint,
  type LeadRunResult,
  type PlannerProvider,
  type RunLeadInput,
  type SpecialistRegistry,
  type StepSnapshot,
} from "./lead";
export {
  MIN_ESTIMATION_DAYS,
  eventStudy,
  eventStudyFromCloses,
  fitMarketModel,
  toReturns,
  type EventStudyResult,
  type MarketModel,
} from "./eventStudy";
export {
  MIN_SAMPLES_TO_RANK,
  rankAgents,
  scoreAgent,
  topKAgents,
  type AgentAccuracy,
  type GradedFindingRow,
} from "./accuracyRanker";
export {
  CALIBRATION_DEFAULTS,
  calibrationReport,
  gradeForecast,
  type CalibrationBucket,
  type CalibrationReport,
  type ForecastGrade,
} from "./kronosCalibration";
export {
  LAYER_POLICIES,
  MAX_REINFORCEMENT_DELTA,
  canPromote,
  compoundScore,
  cosineSimilarity,
  estimateTokens,
  expiryFor,
  rankMemories,
  reinforceImportance,
  renderDecisionMemory,
  type DecisionMemoryEntry,
  type LayerPolicy,
  type MemoryItem,
  type MemoryLayer,
  type PromotionDecision,
  type RankedMemory,
} from "./memory";
export {
  DEDUCTION_RUBRIC,
  JudgeVerdict,
  gradeFinding,
  median,
  scoreFromVerdict,
  type DeductionCode,
  type FindingGrade,
  type JudgeInput,
  type JudgeProvider,
  type JudgeScore,
} from "./judgePanel";
