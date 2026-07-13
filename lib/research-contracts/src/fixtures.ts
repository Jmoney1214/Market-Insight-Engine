/** Valid fixture instances — shared by tests and downstream packages' tests. */
import { finalize } from "./canonical";
import type {
  CandidateSeed,
  CandidatePacket,
  CatalystRecord,
  Claim,
  SourceAudit,
  SourceDocument,
  TextFactor,
  SentimentReading,
  MacroContext,
  CapitalStructure,
  PacketDependencyManifest,
} from "./contracts";

const T = "2026-07-13T09:15:00-04:00";

export const seedFixture = (): CandidateSeed =>
  finalize({
    contract: "CandidateSeed",
    version: "1.0.0",
    candidateId: "cand_01",
    symbol: "RGTI",
    securityIdentity: { cik: "0001838359", figi: null, securityType: "COMMON_STOCK" },
    discoveryReasonCodes: ["GAP", "RELATIVE_VOLUME"],
    marketDataProvider: "alpaca",
    marketDataFeed: "sip",
    marketDataAsOf: T,
    scannerVersion: "1.0.0",
    scannerConfigHash: null,
    createdAt: T,
    expiresAt: "2026-07-13T09:45:00-04:00",
  }) as CandidateSeed;

export const sourceDocFixture = (): SourceDocument => ({
  contract: "SourceDocument",
  version: "1.0.0",
  sourceDocumentId: "src_01",
  canonicalUrl: "https://www.sec.gov/Archives/edgar/data/x/8k.htm",
  providerDocumentId: "0000000000-26-000001",
  publisher: "U.S. Securities and Exchange Commission",
  sourceClass: "PRIMARY_REGULATOR",
  documentType: "SEC_8_K",
  symbols: ["RGTI"],
  publicationTime: T,
  eventTime: T,
  firstKnownTime: T,
  retrievedAt: T,
  asOf: T,
  rawSha256: "sha256:" + "a".repeat(64),
  contentStored: true,
});

export const claimFixture = (): Claim => ({
  contract: "Claim",
  version: "1.0.0",
  claimId: "claim_01",
  symbol: "RGTI",
  cik: "0001838359",
  predicate: "ANNOUNCED_CONTRACT",
  text: "Company announced a government contract award.",
  structuredValue: null,
  unit: null,
  assertedByAgent: "catalyst-verifier",
  assertedAt: T,
  criticality: "CORE",
  requiredForCompletion: true,
  evidence: [
    {
      sourceDocumentId: "src_01",
      passageLocator: { type: "SECTION", value: "Item 8.01" },
      supportType: "DIRECT",
    },
  ],
});

export const auditFixture = (): SourceAudit => ({
  contract: "SourceAudit",
  version: "1.0.0",
  auditId: "audit_01",
  claimId: "claim_01",
  validationStatus: "SUPPORTED",
  supportingSourceIds: ["src_01"],
  excludedSources: [],
  temporalStatus: "CURRENT",
  entityStatus: "MATCHED",
  numericStatus: "NOT_APPLICABLE",
  auditReasonCodes: ["PRIMARY_SOURCE", "PASSAGE_ENTAILS_CLAIM"],
  auditedBy: "source-guardian",
  agentVersion: "1.0.0",
  createdAt: T,
});

export const catalystFixture = (): CatalystRecord => ({
  contract: "CatalystRecord",
  version: "1.0.0",
  catalystId: "cat_01",
  symbol: "RGTI",
  eventType: "CONTRACT_AWARD",
  eventDescription: "Government contract award announced pre-market.",
  publicationTime: T,
  eventTime: T,
  firstKnownTime: T,
  verificationStatus: "CONFIRMED",
  materiality: "POSSIBLY_MATERIAL",
  primarySourceIds: ["src_01"],
  secondarySourceIds: [],
  claimIds: ["claim_01"],
  conflictIds: [],
  duplicateClusterId: null,
  correctionOfCatalystId: null,
  unknownFields: [],
  retrievedAt: T,
  asOf: T,
  expiresAt: "2026-07-13T16:00:00-04:00",
});

export const factorFixture = (): TextFactor => ({
  contract: "TextFactor",
  version: "1.0.0",
  factorId: "factor_01",
  symbol: "RGTI",
  factorType: "CONTRACT_AWARD",
  direction: "POSITIVE",
  strength: 0.8,
  summary: "Confirmed government contract award; primary source on file.",
  eventTime: T,
  evidenceIds: ["src_01"],
  verificationStatus: "CONFIRMED",
  producedBy: "catalyst-verifier",
  asOf: T,
});

export const sentimentFixture = (): SentimentReading => ({
  contract: "SentimentReading",
  version: "1.0.0",
  readingId: "sent_01",
  symbol: "RGTI",
  band: "BULLISH",
  score: 0.55,
  confidence: 0.7,
  sources: [
    { kind: "NEWS", itemCount: 9 },
    { kind: "REDDIT", itemCount: 22 },
    { kind: "X", itemCount: 41 },
  ],
  evidenceIds: ["src_01"],
  isEventProof: false,
  asOf: T,
});

export const macroFixture = (): MacroContext => ({
  contract: "MacroContext",
  version: "1.0.0",
  macroContextId: "macro_01",
  required: true,
  triggerReasonCodes: ["CPI_RELEASE_WINDOW"],
  activeEvents: [
    {
      eventType: "CPI",
      scheduledTime: "2026-07-14T08:30:00-04:00",
      reportedValue: null,
      consensusValue: 2.6,
      unit: "PERCENT_YOY",
      revisionStatus: "UNKNOWN",
      sourceDocumentId: null,
    },
  ],
  tickerSensitivity: "POSSIBLE",
  causalConfidence: "LOW",
  unknownFields: [],
  asOf: T,
});

export const capitalFixture = (): CapitalStructure => ({
  contract: "CapitalStructure",
  version: "1.0.0",
  diligenceId: "cap_01",
  symbol: "RGTI",
  lifecycleType: "MATURE",
  filings: [
    { form: "10-Q", accessionNumber: "0000000000-26-000002", acceptedAt: T, sourceDocumentId: "src_01" },
  ],
  sharesOutstanding: { value: 250_000_000, status: "CONFIRMED", method: null, claimId: "claim_01" },
  estimatedTradableFloat: { value: null, status: "UNKNOWN", method: null, claimId: null },
  offeringPrice: { value: null, status: "NOT_APPLICABLE", method: null, claimId: null },
  lockupTerms: [],
  warrantsAndConvertibles: [],
  dilutionEvents: [],
  unknownFields: [{ path: "/estimatedTradableFloat/value", reasonCode: "INSUFFICIENT_SOURCE_DETAIL", attemptedSourceIds: ["src_01"], blocking: false }],
  asOf: T,
});

export const manifestFixture = (): PacketDependencyManifest =>
  finalize({
    contract: "PacketDependencyManifest",
    version: "1.0.0",
    manifestId: "pdm_01",
    entries: [
      { objectType: "CandidateSeed", objectId: "cand_01", objectVersion: "1.0.0", canonicalSha256: "sha256:" + "b".repeat(64) },
      { objectType: "CatalystRecord", objectId: "cat_01", objectVersion: "1.0.0", canonicalSha256: "sha256:" + "c".repeat(64) },
    ],
    createdAt: T,
  }) as PacketDependencyManifest;

export const packetFixture = (): CandidatePacket =>
  finalize({
    contract: "CandidatePacket",
    version: "1.0.0",
    packetId: "packet_01",
    packetRevision: 1,
    supersedesPacketId: null,
    candidateId: "cand_01",
    symbol: "RGTI",
    researchOutcome: "COMPLETE",
    researchMode: "STANDARD",
    checks: {
      catalyst: "COMPLETED",
      sourceAudit: "COMPLETED",
      sentiment: "COMPLETED",
      macro: "NOT_REQUIRED",
      capitalStructure: "NOT_REQUIRED",
    },
    catalystRecordIds: ["cat_01"],
    textFactorIds: ["factor_01"],
    sentimentReadingId: "sent_01",
    macroContextId: null,
    capitalStructureId: null,
    sourceAuditIds: ["audit_01"],
    conflictIds: [],
    unknownFields: [],
    includedSourceIds: ["src_01"],
    dependencyManifestRef: { manifestId: "pdm_01", manifestSha256: "sha256:" + "d".repeat(64) },
    provenance: {
      runId: "run_01",
      leadAgentId: "market-research-lead",
      leadAgentVersion: "1.0.0",
      configHash: null,
      gitSha: null,
      sourcePolicyVersion: "1.0.0",
    },
    createdAt: T,
    asOf: T,
    expiresAt: "2026-07-13T16:00:00-04:00",
  }) as CandidatePacket;
