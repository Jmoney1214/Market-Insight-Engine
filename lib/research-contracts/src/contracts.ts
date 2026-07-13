/**
 * Research-layer contracts — Zod v4 as the single source of truth.
 *
 * Rules (research-layer buildout §5):
 * - strict objects everywhere: unknown properties are rejected;
 * - UNKNOWN ≠ NOT_REQUIRED ≠ NOT_APPLICABLE, always distinct enum members;
 * - finalize-then-validate: hashed contracts REQUIRE canonicalSha256 — drafts
 *   are internal Omit<> types, never validated as contract instances;
 * - no cross-field refinements here (keeps generated JSON Schema clean) —
 *   cross-field checks live in application validators.
 *
 * JSON Schemas in ../schemas are GENERATED from this file (pnpm codegen);
 * schema-sync.test.ts fails CI on drift.
 */
import { z } from "zod/v4";

// ---- scalars ---------------------------------------------------------------
export const IsoDateTime = z.iso.datetime({ offset: true });
export const Sha256 = z.string().regex(/^sha256:[0-9a-f]{64}$/);
export const TickerSymbol = z.string().regex(/^[A-Z0-9.\-=^]{1,12}$/);
export const SemVer = z.string().regex(/^\d+\.\d+\.\d+$/);
export const Id = z.string().min(1).max(120);

// ---- enums -----------------------------------------------------------------
export const SourceClass = z.enum([
  "PRIMARY_REGULATOR",
  "PRIMARY_COMPANY",
  "PRIMARY_EXCHANGE",
  "LICENSED_WIRE",
  "LICENSED_ANALYTICS",
  "REPUTABLE_SECONDARY",
  "USER_GENERATED",
  "BROWSER_PRESENTATION",
]);

export const AuditStatus = z.enum([
  "SUPPORTED",
  "PARTIALLY_SUPPORTED",
  "CONFLICTED",
  "UNSUPPORTED",
  "UNKNOWN",
]);

export const VerificationStatus = z.enum([
  "CONFIRMED",
  "PARTIALLY_CONFIRMED",
  "CONFLICTED",
  "STALE",
  "UNSUPPORTED",
  "UNKNOWN",
  "NOT_MATERIAL",
  "DUPLICATE",
  "RETRACTED_OR_CORRECTED",
  "PRIMARY_SOURCE_MISSING",
]);

export const CatalystEventType = z.enum([
  "EARNINGS_GUIDANCE",
  "SEC_FILING",
  "OFFERING_DILUTION",
  "MERGER_ACQUISITION",
  "ANALYST_ACTION",
  "FDA_CLINICAL",
  "CONTRACT_AWARD",
  "MANAGEMENT_CHANGE",
  "LITIGATION_REGULATORY",
  "EXCHANGE_NOTICE",
  "PRESS_RELEASE",
  "SECTOR_SYMPATHY",
  "CORPORATE_ACTION",
]);

export const ResearchOutcome = z.enum([
  "COMPLETE",
  "PARTIAL",
  "BLOCKED",
  "FAILED",
  "CANCELED",
  "TIMED_OUT",
  "BUDGET_EXCEEDED",
]);

export const CheckState = z.enum(["NOT_REQUIRED", "COMPLETED", "FAILED", "UNKNOWN"]);
export const Criticality = z.enum(["CORE", "SUPPORTING"]);
export const FactorDirection = z.enum(["POSITIVE", "NEGATIVE", "NEUTRAL"]);
export const SentimentBand = z.enum([
  "STRONG_BEARISH",
  "BEARISH",
  "NEUTRAL",
  "BULLISH",
  "STRONG_BULLISH",
]);
export const AttentionKind = z.enum(["NEWS", "REDDIT", "X", "OTHER_SOCIAL"]);
export const CausalConfidence = z.enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]);
export const LifecycleType = z.enum([
  "RECENT_IPO",
  "DIRECT_LISTING",
  "SPAC",
  "DE_SPAC",
  "FOLLOW_ON_OFFERING",
  "ATM_PROGRAM",
  "ACTIVE_SHELF",
  "LOCKUP_EVENT",
  "MATURE",
  "UNKNOWN",
]);
export const FieldStatus = z.enum(["CONFIRMED", "ESTIMATED", "UNKNOWN", "NOT_APPLICABLE"]);

// ---- CandidateSeed (hashed) --------------------------------------------------
export const SecurityIdentity = z.strictObject({
  cik: z.string().nullable(),
  figi: z.string().nullable(),
  securityType: z.string(),
});

export const CandidateSeed = z.strictObject({
  contract: z.literal("CandidateSeed"),
  version: SemVer,
  candidateId: Id,
  symbol: TickerSymbol,
  securityIdentity: SecurityIdentity,
  discoveryReasonCodes: z.array(z.string()).min(1),
  marketDataProvider: z.string(),
  marketDataFeed: z.string(),
  marketDataAsOf: IsoDateTime,
  scannerVersion: z.string(),
  scannerConfigHash: Sha256.nullable(),
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime,
  canonicalSha256: Sha256,
});
export type CandidateSeed = z.infer<typeof CandidateSeed>;
export type CandidateSeedDraft = Omit<CandidateSeed, "canonicalSha256">;

// ---- Evidence: SourceDocument + Claim ---------------------------------------
export const SourceDocument = z.strictObject({
  contract: z.literal("SourceDocument"),
  version: SemVer,
  sourceDocumentId: Id,
  canonicalUrl: z.string().nullable(),
  providerDocumentId: z.string().nullable(),
  publisher: z.string(),
  sourceClass: SourceClass,
  documentType: z.string(),
  symbols: z.array(TickerSymbol),
  publicationTime: IsoDateTime.nullable(),
  eventTime: IsoDateTime.nullable(),
  firstKnownTime: IsoDateTime.nullable(),
  retrievedAt: IsoDateTime,
  asOf: IsoDateTime,
  rawSha256: Sha256.nullable(),
  contentStored: z.boolean(),
});
export type SourceDocument = z.infer<typeof SourceDocument>;

export const PassageLocator = z.strictObject({
  type: z.enum(["JSON_POINTER", "CHAR_RANGE", "SECTION", "WHOLE_DOCUMENT"]),
  value: z.string(),
});

export const ClaimEvidence = z.strictObject({
  sourceDocumentId: Id,
  passageLocator: PassageLocator,
  supportType: z.enum(["DIRECT", "INDIRECT", "CONTEXTUAL"]),
});

export const Claim = z.strictObject({
  contract: z.literal("Claim"),
  version: SemVer,
  claimId: Id,
  symbol: TickerSymbol,
  cik: z.string().nullable(),
  predicate: z.string(),
  text: z.string().min(1),
  structuredValue: z.union([z.number(), z.string(), z.boolean()]).nullable(),
  unit: z.string().nullable(),
  assertedByAgent: Id,
  assertedAt: IsoDateTime,
  criticality: Criticality,
  requiredForCompletion: z.boolean(),
  evidence: z.array(ClaimEvidence),
});
export type Claim = z.infer<typeof Claim>;

// ---- SourceAudit --------------------------------------------------------------
export const SourceAudit = z.strictObject({
  contract: z.literal("SourceAudit"),
  version: SemVer,
  auditId: Id,
  claimId: Id,
  validationStatus: AuditStatus,
  supportingSourceIds: z.array(Id),
  excludedSources: z.array(
    z.strictObject({ sourceDocumentId: Id, reasonCode: z.string() }),
  ),
  temporalStatus: z.enum(["CURRENT", "STALE", "UNKNOWN"]),
  entityStatus: z.enum(["MATCHED", "MISMATCHED", "UNKNOWN"]),
  numericStatus: z.enum(["CONSISTENT", "INCONSISTENT", "NOT_APPLICABLE"]),
  auditReasonCodes: z.array(z.string()),
  auditedBy: Id,
  agentVersion: SemVer,
  createdAt: IsoDateTime,
});
export type SourceAudit = z.infer<typeof SourceAudit>;

// ---- CatalystRecord ------------------------------------------------------------
export const UnknownField = z.strictObject({
  path: z.string(),
  reasonCode: z.string(),
  attemptedSourceIds: z.array(Id),
  blocking: z.boolean(),
});
export type UnknownField = z.infer<typeof UnknownField>;

export const Conflict = z.strictObject({
  contract: z.literal("Conflict"),
  version: SemVer,
  conflictId: Id,
  fieldPath: z.string(),
  values: z
    .array(z.strictObject({ value: z.string(), sourceDocumentId: Id }))
    .min(2),
  resolutionStatus: z.enum(["UNRESOLVED", "RESOLVED_BY_AUTHORITY", "RESOLVED_BY_RECENCY"]),
  preferredValue: z.string().nullable(),
  createdAt: IsoDateTime,
});
export type Conflict = z.infer<typeof Conflict>;

export const CatalystRecord = z.strictObject({
  contract: z.literal("CatalystRecord"),
  version: SemVer,
  catalystId: Id,
  symbol: TickerSymbol,
  eventType: CatalystEventType,
  eventDescription: z.string().min(1),
  publicationTime: IsoDateTime.nullable(),
  eventTime: IsoDateTime.nullable(),
  firstKnownTime: IsoDateTime.nullable(),
  verificationStatus: VerificationStatus,
  materiality: z.enum(["MATERIAL", "POSSIBLY_MATERIAL", "NOT_MATERIAL", "UNKNOWN"]),
  primarySourceIds: z.array(Id),
  secondarySourceIds: z.array(Id),
  claimIds: z.array(Id),
  conflictIds: z.array(Id),
  duplicateClusterId: Id.nullable(),
  correctionOfCatalystId: Id.nullable(),
  unknownFields: z.array(UnknownField),
  retrievedAt: IsoDateTime,
  asOf: IsoDateTime,
  expiresAt: IsoDateTime,
});
export type CatalystRecord = z.infer<typeof CatalystRecord>;

// ---- TextFactor (ContestTrade condensation shape) -------------------------------
export const TextFactor = z.strictObject({
  contract: z.literal("TextFactor"),
  version: SemVer,
  factorId: Id,
  symbol: TickerSymbol,
  factorType: z.string(),
  direction: FactorDirection,
  strength: z.number().min(0).max(1),
  summary: z.string().min(1).max(600),
  eventTime: IsoDateTime.nullable(),
  evidenceIds: z.array(Id).min(1),
  verificationStatus: VerificationStatus,
  producedBy: Id,
  asOf: IsoDateTime,
});
export type TextFactor = z.infer<typeof TextFactor>;

// ---- SentimentReading (grounded, attention-only) ---------------------------------
export const SentimentReading = z.strictObject({
  contract: z.literal("SentimentReading"),
  version: SemVer,
  readingId: Id,
  symbol: TickerSymbol,
  band: SentimentBand,
  score: z.number().min(-1).max(1),
  confidence: z.number().min(0).max(1),
  sources: z.array(
    z.strictObject({ kind: AttentionKind, itemCount: z.int().min(0) }),
  ),
  evidenceIds: z.array(Id),
  // Attention signal only — never event proof (system rule).
  isEventProof: z.literal(false),
  asOf: IsoDateTime,
});
export type SentimentReading = z.infer<typeof SentimentReading>;

// ---- MacroContext -----------------------------------------------------------------
export const MacroContext = z.strictObject({
  contract: z.literal("MacroContext"),
  version: SemVer,
  macroContextId: Id,
  required: z.boolean(),
  triggerReasonCodes: z.array(z.string()),
  activeEvents: z.array(
    z.strictObject({
      eventType: z.string(),
      scheduledTime: IsoDateTime.nullable(),
      reportedValue: z.number().nullable(),
      consensusValue: z.number().nullable(),
      unit: z.string().nullable(),
      revisionStatus: z.enum(["PRELIMINARY", "REVISED", "FINAL", "UNKNOWN"]),
      sourceDocumentId: Id.nullable(),
    }),
  ),
  tickerSensitivity: z.enum(["LIKELY", "POSSIBLE", "UNLIKELY", "UNKNOWN"]),
  causalConfidence: CausalConfidence,
  unknownFields: z.array(UnknownField),
  asOf: IsoDateTime,
});
export type MacroContext = z.infer<typeof MacroContext>;

// ---- CapitalStructure ---------------------------------------------------------------
export const EstimatedNumber = z.strictObject({
  value: z.number().nullable(),
  status: FieldStatus,
  method: z.string().nullable(),
  claimId: Id.nullable(),
});

export const CapitalStructure = z.strictObject({
  contract: z.literal("CapitalStructure"),
  version: SemVer,
  diligenceId: Id,
  symbol: TickerSymbol,
  lifecycleType: LifecycleType,
  filings: z.array(
    z.strictObject({
      form: z.string(),
      accessionNumber: z.string(),
      acceptedAt: IsoDateTime.nullable(),
      sourceDocumentId: Id,
    }),
  ),
  sharesOutstanding: EstimatedNumber,
  estimatedTradableFloat: EstimatedNumber,
  offeringPrice: EstimatedNumber,
  lockupTerms: z.array(z.strictObject({ description: z.string(), expiresAt: IsoDateTime.nullable(), claimId: Id.nullable() })),
  warrantsAndConvertibles: z.array(z.strictObject({ description: z.string(), claimId: Id.nullable() })),
  dilutionEvents: z.array(z.strictObject({ description: z.string(), eventTime: IsoDateTime.nullable(), claimId: Id.nullable() })),
  unknownFields: z.array(UnknownField),
  asOf: IsoDateTime,
});
export type CapitalStructure = z.infer<typeof CapitalStructure>;

// ---- CandidatePacket (hashed) + DependencyManifest (hashed) ---------------------------
export const DependencyEntry = z.strictObject({
  objectType: z.string(),
  objectId: Id,
  objectVersion: SemVer,
  canonicalSha256: Sha256,
});

/** Entries MUST be sorted by (objectType, objectId, objectVersion) — enforced by validators. */
export const PacketDependencyManifest = z.strictObject({
  contract: z.literal("PacketDependencyManifest"),
  version: SemVer,
  manifestId: Id,
  entries: z.array(DependencyEntry),
  createdAt: IsoDateTime,
  canonicalSha256: Sha256,
});
export type PacketDependencyManifest = z.infer<typeof PacketDependencyManifest>;
export type PacketDependencyManifestDraft = Omit<PacketDependencyManifest, "canonicalSha256">;

export const CandidatePacket = z.strictObject({
  contract: z.literal("CandidatePacket"),
  version: SemVer,
  packetId: Id,
  packetRevision: z.int().min(1),
  supersedesPacketId: Id.nullable(),
  candidateId: Id,
  symbol: TickerSymbol,
  researchOutcome: ResearchOutcome,
  researchMode: z.enum(["FAST", "STANDARD", "DEEP"]),
  checks: z.strictObject({
    catalyst: CheckState,
    sourceAudit: CheckState,
    sentiment: CheckState,
    macro: CheckState,
    capitalStructure: CheckState,
  }),
  catalystRecordIds: z.array(Id),
  textFactorIds: z.array(Id),
  sentimentReadingId: Id.nullable(),
  macroContextId: Id.nullable(),
  capitalStructureId: Id.nullable(),
  sourceAuditIds: z.array(Id),
  conflictIds: z.array(Id),
  unknownFields: z.array(UnknownField),
  includedSourceIds: z.array(Id),
  dependencyManifestRef: z.strictObject({ manifestId: Id, manifestSha256: Sha256 }),
  provenance: z.strictObject({
    runId: Id,
    leadAgentId: Id,
    leadAgentVersion: SemVer,
    configHash: Sha256.nullable(),
    gitSha: z.string().nullable(),
    sourcePolicyVersion: SemVer,
  }),
  createdAt: IsoDateTime,
  asOf: IsoDateTime,
  expiresAt: IsoDateTime,
  canonicalSha256: Sha256,
});
export type CandidatePacket = z.infer<typeof CandidatePacket>;
export type CandidatePacketDraft = Omit<CandidatePacket, "canonicalSha256">;

// ---- AgentOutput envelope --------------------------------------------------------------
export const AgentOutput = z.strictObject({
  contract: z.literal("AgentOutput"),
  version: SemVer,
  agentId: Id,
  agentVersion: SemVer,
  manifestHash: Sha256.nullable(),
  runId: Id,
  payloadContract: z.string(),
  payloadVersion: SemVer,
  producedAt: IsoDateTime,
  payload: z.unknown(),
});
export type AgentOutput = z.infer<typeof AgentOutput>;

// ---- registry (drives JSON Schema generation + drift check) -----------------------------
export const CONTRACT_REGISTRY = {
  CandidateSeed,
  SourceDocument,
  Claim,
  SourceAudit,
  Conflict,
  CatalystRecord,
  TextFactor,
  SentimentReading,
  MacroContext,
  CapitalStructure,
  PacketDependencyManifest,
  CandidatePacket,
  AgentOutput,
} as const;
export type ContractName = keyof typeof CONTRACT_REGISTRY;
