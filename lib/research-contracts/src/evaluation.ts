import { z } from "zod";

import { FmpEndpointFamilySchema } from "./run.js";
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

export const PrincipalDecisionSubjectSchema = z
  .object({
    subjectType: z.literal("PRINCIPAL"),
    principalId: z.string().min(1),
    principalSha256: Sha256Schema,
  })
  .strict();

export const CredentialDecisionSubjectSchema = z
  .object({
    subjectType: z.literal("CREDENTIAL"),
    credentialId: z.string().min(1),
    credentialSha256: Sha256Schema,
  })
  .strict();

export const BrowserSessionDecisionSubjectSchema = z
  .object({
    subjectType: z.literal("BROWSER_SESSION"),
    browserSessionId: z.string().min(1),
    browserSessionSha256: Sha256Schema,
  })
  .strict();

export const LearningCaseDecisionSubjectSchema = z
  .object({
    subjectType: z.literal("LEARNING_CASE"),
    caseRevisionId: z.string().min(1),
    caseRevisionSha256: Sha256Schema,
  })
  .strict();

export const ReleaseDecisionSubjectSchema = z
  .object({
    subjectType: z.literal("RELEASE"),
    releaseFingerprintSha256: Sha256Schema,
    releaseEvaluationSha256: Sha256Schema,
  })
  .strict();

export const PacketPublicationDecisionSubjectSchema = z
  .object({
    subjectType: z.literal("PACKET"),
    packetSha256: Sha256Schema,
    packetPublicationSubjectSha256: Sha256Schema,
  })
  .strict();

export const PrincipalDecisionSchema = z
  .object({
    ...DecisionShape,
    decisionType: z.literal("PRINCIPAL"),
    verdict: z.enum(["ACTIVATE", "SUSPEND", "REVOKE"]),
    subject: PrincipalDecisionSubjectSchema,
  })
  .strict();

export const CredentialDecisionSchema = z
  .object({
    ...DecisionShape,
    decisionType: z.literal("CREDENTIAL"),
    verdict: z.enum(["ACTIVATE", "REVOKE"]),
    subject: CredentialDecisionSubjectSchema,
  })
  .strict();

export const BrowserSessionDecisionSchema = z
  .object({
    ...DecisionShape,
    decisionType: z.literal("BROWSER_SESSION"),
    verdict: z.literal("REVOKE"),
    subject: BrowserSessionDecisionSubjectSchema,
  })
  .strict();

export const LearningCaseDecisionSchema = z
  .object({
    ...DecisionShape,
    decisionType: z.literal("LEARNING_CASE"),
    verdict: z.enum(["PROMOTE", "QUARANTINE", "SUPERSEDE"]),
    subject: LearningCaseDecisionSubjectSchema,
    targetPartition: CasePartitionSchema.nullable(),
  })
  .strict();

export const ReleaseDecisionSchema = z
  .object({
    ...DecisionShape,
    decisionType: z.literal("RELEASE"),
    verdict: z.enum(["APPROVE", "REJECT", "RELOCK", "REVOKE"]),
    subject: ReleaseDecisionSubjectSchema,
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
    subject: PacketPublicationDecisionSubjectSchema,
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

export const EvaluationProviderSchema = z.enum([
  "ALPACA_SIP",
  "FMP",
  "OPENAI",
  "ANTHROPIC",
]);

export const RequiredProviderConditionSchema = z
  .object({
    provider: EvaluationProviderSchema,
    condition: z.enum(["AVAILABLE", "OUTAGE_FAIL_CLOSED"]),
    endpointFamily: FmpEndpointFamilySchema.nullable(),
  })
  .strict()
  .superRefine((condition, context) => {
    if (condition.provider === "FMP" && condition.endpointFamily === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endpointFamily"],
        message: "FMP provider conditions require an endpoint family",
      });
    }

    if (condition.provider !== "FMP" && condition.endpointFamily !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endpointFamily"],
        message: "only FMP provider conditions may name an endpoint family",
      });
    }
  });

export const ActiveSuiteCaseSchema = z
  .object({
    caseRevisionId: z.string().min(1),
    instrumentClass: InstrumentClassSchema,
    catalystPolarity: CatalystPolaritySchema,
    failureTags: z.array(FailureTagSchema),
    requiredProviderConditions: z.array(RequiredProviderConditionSchema).min(1),
    expectedLabelSha256: Sha256Schema,
  })
  .strict()
  .superRefine((suiteCase, context) => {
    if (new Set(suiteCase.failureTags).size !== suiteCase.failureTags.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["failureTags"],
        message: "failure tags must be unique within a suite case",
      });
    }

    const providerConditionKeys = suiteCase.requiredProviderConditions.map(
      (condition) =>
        `${condition.provider}:${condition.condition}:${condition.endpointFamily ?? ""}`,
    );
    if (new Set(providerConditionKeys).size !== providerConditionKeys.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requiredProviderConditions"],
        message: "provider conditions must be unique within a suite case",
      });
    }
  });

const ZeroToleranceFailureTags = [
  "FALSE_CATALYST",
  "WRONG_ENTITY_OR_SECURITY",
  "STALE_AS_NEW",
  "MISSED_CORRECTION_OR_RETRACTION",
  "UNSUPPORTED_MATERIAL_CLAIM",
  "NON_SUPPORTING_CITATION",
] as const;

export const ActiveSuiteManifestSchema = z
  .object({
    suiteManifestId: z.string().min(1),
    suiteVersion: z.string().min(1),
    createdAt: z.string().datetime({ offset: true }),
    rubricVersion: z.string().min(1),
    rubricSha256: Sha256Schema,
    cases: z.array(ActiveSuiteCaseSchema).min(20),
    activeSuiteSha256: Sha256Schema,
  })
  .strict()
  .superRefine((manifest, context) => {
    const caseRevisionIds = manifest.cases.map(
      (suiteCase) => suiteCase.caseRevisionId,
    );
    if (new Set(caseRevisionIds).size !== caseRevisionIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cases"],
        message: "active suite case revision IDs must be unique",
      });
    }

    for (const instrumentClass of InstrumentClassSchema.options) {
      const classCases = manifest.cases.filter(
        (suiteCase) => suiteCase.instrumentClass === instrumentClass,
      );
      for (const catalystPolarity of CatalystPolaritySchema.options) {
        if (
          !classCases.some(
            (suiteCase) => suiteCase.catalystPolarity === catalystPolarity,
          )
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["cases"],
            message: `${instrumentClass} requires a ${catalystPolarity} case`,
          });
        }
      }
    }

    for (const failureTag of ZeroToleranceFailureTags) {
      const taggedCases = manifest.cases.filter((suiteCase) =>
        suiteCase.failureTags.includes(failureTag),
      );
      const representedClasses = new Set(
        taggedCases.map((suiteCase) => suiteCase.instrumentClass),
      );
      if (taggedCases.length < 3 || representedClasses.size < 2) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cases"],
          message: `${failureTag} requires at least three cases across two instrument classes`,
        });
      }
    }

    const requiredProviders = new Set(
      manifest.cases.flatMap((suiteCase) =>
        suiteCase.requiredProviderConditions.map(
          (condition) => condition.provider,
        ),
      ),
    );
    for (const provider of requiredProviders) {
      const hasOutageControl = manifest.cases.some((suiteCase) =>
        suiteCase.requiredProviderConditions.some(
          (condition) =>
            condition.provider === provider &&
            condition.condition === "OUTAGE_FAIL_CLOSED",
        ),
      );
      if (!hasOutageControl) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cases"],
          message: `${provider} requires an outage fail-closed control`,
        });
      }
    }
  });

export const TrialSeriesStatusSchema = z.enum(["RUNNING", "FAILED", "PASSED"]);

export const TrialSeriesSchema = z
  .object({
    trialSeriesId: z.string().min(1),
    releaseFingerprintSha256: Sha256Schema,
    activeSuiteSha256: Sha256Schema,
    rubricSha256: Sha256Schema,
    releasePolicySha256: Sha256Schema,
    status: TrialSeriesStatusSchema,
    startedAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict()
  .superRefine((series, context) => {
    if (series.status === "RUNNING" && series.completedAt !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completedAt"],
        message: "a running trial series cannot be completed",
      });
    }
    if (series.status !== "RUNNING" && series.completedAt === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completedAt"],
        message: "a terminal trial series requires completedAt",
      });
    }
    if (
      series.completedAt !== null &&
      Date.parse(series.completedAt) < Date.parse(series.startedAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completedAt"],
        message: "trial series completion cannot precede its start",
      });
    }
  });

export const TrialCaseResultSchema = z
  .object({
    caseRevisionId: z.string().min(1),
    runId: z.string().uuid(),
    verdict: z.enum(["PASS", "FAIL"]),
    outputSha256: Sha256Schema,
    providerResponseIds: z.array(z.string().min(1)).min(1),
    deterministicGraderResultIds: z.array(z.string().min(1)).min(1),
    opposingModelGraderResultId: z.string().min(1),
    cachedProviderResponsesUsed: z.literal(false),
  })
  .strict()
  .superRefine((result, context) => {
    if (
      new Set(result.providerResponseIds).size !==
      result.providerResponseIds.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerResponseIds"],
        message: "provider response IDs must be unique within a case result",
      });
    }
    if (
      new Set(result.deterministicGraderResultIds).size !==
      result.deterministicGraderResultIds.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["deterministicGraderResultIds"],
        message: "deterministic grader result IDs must be unique",
      });
    }
  });

export const TrialBatchSchema = z
  .object({
    trialBatchId: z.string().min(1),
    trialSeriesId: z.string().min(1),
    ordinal: z.number().int().min(1).max(5),
    releaseFingerprintSha256: Sha256Schema,
    activeSuiteSha256: Sha256Schema,
    rubricSha256: Sha256Schema,
    releasePolicySha256: Sha256Schema,
    verdict: z.enum(["PASS", "FAIL"]),
    startedAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }),
    caseResults: z.array(TrialCaseResultSchema).min(1),
  })
  .strict()
  .superRefine((batch, context) => {
    const caseRevisionIds = batch.caseResults.map(
      (result) => result.caseRevisionId,
    );
    if (new Set(caseRevisionIds).size !== caseRevisionIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["caseResults"],
        message: "a trial batch cannot repeat a case revision",
      });
    }

    const runIds = batch.caseResults.map((result) => result.runId);
    if (new Set(runIds).size !== runIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["caseResults"],
        message: "a trial batch cannot reuse a run",
      });
    }

    const providerResponseIds = batch.caseResults.flatMap(
      (result) => result.providerResponseIds,
    );
    if (new Set(providerResponseIds).size !== providerResponseIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["caseResults"],
        message: "a trial batch cannot reuse a provider response",
      });
    }

    const everyCasePassed = batch.caseResults.every(
      (result) => result.verdict === "PASS",
    );
    if (
      (batch.verdict === "PASS" && !everyCasePassed) ||
      (batch.verdict === "FAIL" && everyCasePassed)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["verdict"],
        message: "batch verdict must equal its aggregate case verdict",
      });
    }

    if (Date.parse(batch.completedAt) < Date.parse(batch.startedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completedAt"],
        message: "trial batch completion cannot precede its start",
      });
    }
  });

export const HumanCaseBundleGradeSchema = z
  .object({
    caseRevisionId: z.string().min(1),
    bundleSha256: Sha256Schema,
    verdict: z.enum(["PASS", "FAIL"]),
    humanGradeId: z.string().min(1),
  })
  .strict();

function haveSameStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((value, index) => value === sortedRight[index])
  );
}

export const FiveBatchTrialMatrixSchema = z
  .object({
    trialMatrixId: z.string().min(1),
    activeSuiteManifest: ActiveSuiteManifestSchema,
    series: TrialSeriesSchema,
    batches: z.array(TrialBatchSchema).length(5),
    humanCaseGrades: z.array(HumanCaseBundleGradeSchema).min(1),
    complete: z.boolean(),
    matrixSha256: Sha256Schema,
  })
  .strict()
  .superRefine((matrix, context) => {
    if (
      matrix.series.activeSuiteSha256 !==
      matrix.activeSuiteManifest.activeSuiteSha256
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["series", "activeSuiteSha256"],
        message: "trial series hash does not match the embedded active suite",
      });
    }
    if (
      matrix.series.rubricSha256 !== matrix.activeSuiteManifest.rubricSha256
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["series", "rubricSha256"],
        message: "trial series rubric does not match the active suite rubric",
      });
    }

    const ordinals = matrix.batches.map((batch) => batch.ordinal);
    if (
      new Set(ordinals).size !== 5 ||
      ![1, 2, 3, 4, 5].every((ordinal) => ordinals.includes(ordinal))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["batches"],
        message:
          "trial matrix requires exactly one batch at each ordinal 1 through 5",
      });
    }

    const trialBatchIds = matrix.batches.map((batch) => batch.trialBatchId);
    if (new Set(trialBatchIds).size !== trialBatchIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["batches"],
        message: "independent trial batches require distinct batch IDs",
      });
    }

    const seriesHashes = {
      releaseFingerprintSha256: matrix.series.releaseFingerprintSha256,
      activeSuiteSha256: matrix.series.activeSuiteSha256,
      rubricSha256: matrix.series.rubricSha256,
      releasePolicySha256: matrix.series.releasePolicySha256,
    };
    for (const [batchIndex, batch] of matrix.batches.entries()) {
      if (batch.trialSeriesId !== matrix.series.trialSeriesId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["batches", batchIndex, "trialSeriesId"],
          message: "batch belongs to a different trial series",
        });
      }
      for (const [hashName, seriesHash] of Object.entries(seriesHashes)) {
        if (batch[hashName as keyof typeof seriesHashes] !== seriesHash) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["batches", batchIndex, hashName],
            message: "batch hash does not match its trial series",
          });
        }
      }
    }

    const activeCaseRevisionIds = matrix.activeSuiteManifest.cases.map(
      (suiteCase) => suiteCase.caseRevisionId,
    );
    for (const [batchIndex, batch] of matrix.batches.entries()) {
      if (
        !haveSameStringSet(
          batch.caseResults.map((result) => result.caseRevisionId),
          activeCaseRevisionIds,
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["batches", batchIndex, "caseResults"],
          message:
            "every trial batch must contain the exact active suite case revisions",
        });
      }
    }

    const allProviderResponseIds = matrix.batches.flatMap((batch) =>
      batch.caseResults.flatMap((result) => result.providerResponseIds),
    );
    if (
      new Set(allProviderResponseIds).size !== allProviderResponseIds.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["batches"],
        message: "independent trial batches cannot reuse provider responses",
      });
    }

    const allRunIds = matrix.batches.flatMap((batch) =>
      batch.caseResults.map((result) => result.runId),
    );
    if (new Set(allRunIds).size !== allRunIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["batches"],
        message: "independent trial batches cannot reuse runs",
      });
    }

    const deterministicGraderResultIds = matrix.batches.flatMap((batch) =>
      batch.caseResults.flatMap(
        (result) => result.deterministicGraderResultIds,
      ),
    );
    const opposingModelGraderResultIds = matrix.batches.flatMap((batch) =>
      batch.caseResults.map((result) => result.opposingModelGraderResultId),
    );

    const humanCaseRevisionIds = matrix.humanCaseGrades.map(
      (grade) => grade.caseRevisionId,
    );
    const humanGradeIds = matrix.humanCaseGrades.map(
      (grade) => grade.humanGradeId,
    );
    if (
      new Set(humanCaseRevisionIds).size !== humanCaseRevisionIds.length ||
      new Set(humanGradeIds).size !== humanGradeIds.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["humanCaseGrades"],
        message: "human case grades and their IDs must be unique",
      });
    }
    if (!haveSameStringSet(humanCaseRevisionIds, activeCaseRevisionIds)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["humanCaseGrades"],
        message: "every trial case requires exactly one human bundle grade",
      });
    }

    const everyGraderResultId = [
      ...deterministicGraderResultIds,
      ...opposingModelGraderResultIds,
      ...humanGradeIds,
    ];
    if (new Set(everyGraderResultId).size !== everyGraderResultId.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["batches"],
        message:
          "deterministic, opposing-model, and human grader result IDs must be globally unique",
      });
    }

    const allBatchesPassed = matrix.batches.every(
      (batch) => batch.verdict === "PASS",
    );
    const allHumanGradesPassed = matrix.humanCaseGrades.every(
      (grade) => grade.verdict === "PASS",
    );
    if (
      matrix.complete &&
      (!allBatchesPassed ||
        !allHumanGradesPassed ||
        matrix.series.status !== "PASSED")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["complete"],
        message:
          "a complete matrix requires a passed series, batches, and human grades",
      });
    }
    if (matrix.series.status === "PASSED" && !matrix.complete) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["series", "status"],
        message: "a passed trial series requires a complete matrix",
      });
    }
    if (
      matrix.series.status === "FAILED" &&
      (matrix.complete || allBatchesPassed)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["series", "status"],
        message:
          "a failed trial series requires a failed batch and incomplete matrix",
      });
    }
    if (matrix.series.status === "RUNNING" && matrix.complete) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["series", "status"],
        message: "a running trial series cannot have a complete matrix",
      });
    }
  });

export type CaseState = z.infer<typeof CaseStateSchema>;
export type CasePartition = z.infer<typeof CasePartitionSchema>;
export type InstrumentClass = z.infer<typeof InstrumentClassSchema>;
export type LearningCase = z.infer<typeof LearningCaseSchema>;
export type GraderResult = z.infer<typeof GraderResultSchema>;
export type GovernanceDecision = z.infer<typeof GovernanceDecisionSchema>;
export type ActiveSuiteManifest = z.infer<typeof ActiveSuiteManifestSchema>;
export type TrialSeries = z.infer<typeof TrialSeriesSchema>;
export type TrialBatch = z.infer<typeof TrialBatchSchema>;
export type FiveBatchTrialMatrix = z.infer<typeof FiveBatchTrialMatrixSchema>;
