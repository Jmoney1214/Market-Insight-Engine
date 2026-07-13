import { z } from "zod";

import { ModelProviderSchema, Sha256Schema } from "./version.js";

export const CaseStateSchema = z.enum([
  "CANDIDATE",
  "GRADED",
  "GOLDEN",
  "SUPERSEDED",
]);

export const CasePartitionSchema = z.enum([
  "TRAINING",
  "VALIDATION",
  "HOLDOUT",
  "QUARANTINED",
]);

export const InstrumentClassSchema = z.enum([
  "LARGE_CAP_COMMON",
  "MID_CAP_COMMON",
  "SMALL_CAP_COMMON",
  "MICRO_CAP_LOW_FLOAT_COMMON",
  "BIOTECH_FDA",
  "RECENT_IPO",
  "SPAC_DE_SPAC",
  "ADR_FOREIGN_ISSUER",
  "ETF_MACRO_PROXY",
  "NO_CATALYST_CONTROL",
]);

export const CatalystPolaritySchema = z.enum(["POSITIVE", "NEGATIVE"]);

export const FailureTagSchema = z.enum([
  "FALSE_CATALYST",
  "WRONG_ENTITY_OR_SECURITY",
  "STALE_AS_NEW",
  "MISSED_CORRECTION_OR_RETRACTION",
  "UNSUPPORTED_MATERIAL_CLAIM",
  "NON_SUPPORTING_CITATION",
  "SYNDICATION_DUPLICATION",
  "CONFLICTING_TIMESTAMPS",
  "REQUIRED_PROVIDER_OUTAGE",
  "UNKNOWN_HANDLING",
  "NOT_REQUIRED_HANDLING",
  "NOT_APPLICABLE_HANDLING",
]);

export const LearningCaseSchema = z
  .object({
    caseId: z.string().min(1),
    revisionId: z.string().min(1),
    revision: z.number().int().positive(),
    state: CaseStateSchema,
    partition: CasePartitionSchema,
    instrumentClass: InstrumentClassSchema,
    catalystPolarity: CatalystPolaritySchema,
    failureTags: z.array(FailureTagSchema),
    originatingRunId: z.string().uuid(),
    evidenceGraphSha256: Sha256Schema,
    expectedLabelSha256: Sha256Schema.nullable(),
    supersedesRevisionId: z.string().min(1).nullable(),
  })
  .strict();

export const GradeVerdictSchema = z.enum([
  "PASS",
  "FAIL",
  "UNKNOWN",
  "NOT_APPLICABLE",
]);

const GraderResultShape = {
  gradeId: z.string().min(1),
  runId: z.string().uuid(),
  caseRevisionId: z.string().min(1),
  trialSeriesId: z.string().min(1),
  batchOrdinal: z.number().int().min(1).max(5),
  rubricSha256: Sha256Schema,
  outputSha256: Sha256Schema,
  completedAt: z.string().datetime({ offset: true }),
};

export const DeterministicCheckSchema = z
  .object({
    checkId: z.string().min(1),
    verdict: GradeVerdictSchema,
    critical: z.boolean(),
    reasonCodes: z.array(z.string().min(1)),
  })
  .strict();

export const DeterministicGraderResultSchema = z
  .object({
    ...GraderResultShape,
    graderKind: z.literal("DETERMINISTIC"),
    verdict: GradeVerdictSchema,
    checks: z.array(DeterministicCheckSchema).min(1),
  })
  .strict();

export const ModelFieldVerdictSchema = z
  .object({
    fieldId: z.string().min(1),
    verdict: GradeVerdictSchema,
    critical: z.boolean(),
    rationale: z.string(),
  })
  .strict();

export const OpposingModelGraderResultSchema = z
  .object({
    ...GraderResultShape,
    graderKind: z.literal("OPPOSING_MODEL"),
    verdict: GradeVerdictSchema,
    graderProvider: ModelProviderSchema,
    authorProvider: ModelProviderSchema,
    graderManifestId: z.string().min(1),
    graderManifestVersion: z.string().min(1),
    providerResponseId: z.string().min(1),
    fieldVerdicts: z.array(ModelFieldVerdictSchema),
  })
  .strict();

export const HumanGraderResultSchema = z
  .object({
    ...GraderResultShape,
    graderKind: z.literal("HUMAN"),
    verdict: z.enum(["PASS", "FAIL"]),
    bundleSha256: Sha256Schema,
    humanPrincipalId: z.string().min(1),
    credentialId: z.string().min(1),
    rationale: z.string().min(1),
    attestationHmacSha256: Sha256Schema,
  })
  .strict();

const DiscriminatedGraderResultSchema = z.discriminatedUnion("graderKind", [
  DeterministicGraderResultSchema,
  OpposingModelGraderResultSchema,
  HumanGraderResultSchema,
]);

export const GraderResultSchema = DiscriminatedGraderResultSchema.superRefine(
  (result, context) => {
    if (
      result.graderKind === "OPPOSING_MODEL" &&
      result.graderProvider === result.authorProvider
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["graderProvider"],
        message: "a provider cannot grade its own authored output",
      });
    }
  },
);

export const ReleaseStateSchema = z.enum([
  "LOCKED",
  "MACHINE_ELIGIBLE",
  "APPROVED",
  "RELOCKED",
  "REVOKED",
]);

const DecisionShape = {
  decisionId: z.string().min(1),
  rationale: z.string().min(1),
  subjectId: z.string().min(1),
  subjectSha256: Sha256Schema,
  revision: z.number().int().positive(),
  supersedesDecisionId: z.string().min(1).nullable(),
  humanPrincipalId: z.string().min(1),
  credentialId: z.string().min(1),
  requestId: z.string().min(1),
  decidedAt: z.string().datetime({ offset: true }),
  nonce: z.string().min(1),
  attestationKeyId: z.string().min(1),
  attestationHmacSha256: Sha256Schema,
};

export const PrincipalDecisionSchema = z
  .object({
    ...DecisionShape,
    decisionType: z.literal("PRINCIPAL"),
    verdict: z.enum(["ACTIVATE", "SUSPEND", "REVOKE"]),
    principalId: z.string().min(1),
  })
  .strict();

export const CredentialDecisionSchema = z
  .object({
    ...DecisionShape,
    decisionType: z.literal("CREDENTIAL"),
    verdict: z.enum(["ACTIVATE", "REVOKE"]),
    affectedCredentialId: z.string().min(1),
  })
  .strict();

export const BrowserSessionDecisionSchema = z
  .object({
    ...DecisionShape,
    decisionType: z.literal("BROWSER_SESSION"),
    verdict: z.literal("REVOKE"),
    browserSessionId: z.string().min(1),
  })
  .strict();

export const LearningCaseDecisionSchema = z
  .object({
    ...DecisionShape,
    decisionType: z.literal("LEARNING_CASE"),
    verdict: z.enum(["PROMOTE", "QUARANTINE", "SUPERSEDE"]),
    caseRevisionId: z.string().min(1),
    targetPartition: CasePartitionSchema.nullable(),
  })
  .strict();

export const ReleaseDecisionSchema = z
  .object({
    ...DecisionShape,
    decisionType: z.literal("RELEASE"),
    verdict: z.enum(["APPROVE", "REJECT", "RELOCK", "REVOKE"]),
    releaseFingerprintSha256: Sha256Schema,
    releasePolicySha256: Sha256Schema,
    activeSuiteSha256: Sha256Schema,
    rubricSha256: Sha256Schema,
    trialMatrixSha256: Sha256Schema,
  })
  .strict();

export const PacketPublicationDecisionSchema = z
  .object({
    ...DecisionShape,
    decisionType: z.literal("PACKET_PUBLICATION"),
    verdict: z.enum(["PUBLISH", "REJECT"]),
    packetSha256: Sha256Schema,
    packetContractMajor: z.number().int().positive(),
    releaseApprovalId: z.string().min(1),
    graphValidatorSha256: Sha256Schema,
  })
  .strict();

export const GovernanceDecisionSchema = z.discriminatedUnion("decisionType", [
  PrincipalDecisionSchema,
  CredentialDecisionSchema,
  BrowserSessionDecisionSchema,
  LearningCaseDecisionSchema,
  ReleaseDecisionSchema,
  PacketPublicationDecisionSchema,
]);

export type CaseState = z.infer<typeof CaseStateSchema>;
export type CasePartition = z.infer<typeof CasePartitionSchema>;
export type InstrumentClass = z.infer<typeof InstrumentClassSchema>;
export type LearningCase = z.infer<typeof LearningCaseSchema>;
export type GraderResult = z.infer<typeof GraderResultSchema>;
export type GovernanceDecision = z.infer<typeof GovernanceDecisionSchema>;
