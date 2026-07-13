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
  type LeadRunResult,
  type PlannerProvider,
  type RunLeadInput,
  type SpecialistRegistry,
} from "./lead";
