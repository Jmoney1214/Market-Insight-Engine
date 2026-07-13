import { z } from "zod";

import { SourceAuditVerdictSchema } from "./evidence.js";
import { FmpEndpointFamilySchema } from "./run.js";
import { ModelProviderSchema, Sha256Schema } from "./version.js";

export const CandidateSeedSchema = z
  .object({
    seedId: z.string().min(1),
    symbol: z.string().min(1),
    asOf: z.string().datetime({ offset: true }),
    task: z.string().min(1),
    fmpEndpointFamilies: z.array(FmpEndpointFamilySchema),
  })
  .strict();

export const CatalystFreshnessSchema = z.enum([
  "NEW",
  "STALE",
  "CORRECTED",
  "RETRACTED",
  "UNKNOWN",
]);

export const CatalystRecordSchema = z
  .object({
    symbol: z.string().min(1),
    legalEntityName: z.string().min(1),
    cik: z
      .string()
      .regex(/^\d{10}$/)
      .nullable(),
    securityClass: z.string().min(1),
    eventType: z.string().min(1),
    publishedAt: z.string().datetime({ offset: true }),
    eventAt: z.string().datetime({ offset: true }).nullable(),
    firstKnowableAt: z.string().datetime({ offset: true }),
    freshness: CatalystFreshnessSchema,
    sourceEvidenceIds: z.array(z.string().min(1)),
  })
  .strict();

export const DraftClaimSchema = z
  .object({
    claimId: z.string().min(1),
    text: z.string().min(1),
    material: z.boolean(),
    authorProvider: ModelProviderSchema,
  })
  .strict();

export const MarketResearchLeadOutputSchema = z
  .object({
    agentRole: z.literal("market-research-lead"),
    outputId: z.string().min(1),
    runId: z.string().uuid(),
    provider: z.literal("openai"),
    candidateSeed: CandidateSeedSchema,
    planSteps: z.array(z.string().min(1)).min(1),
    draftClaims: z.array(DraftClaimSchema),
  })
  .strict();

export const CatalystVerifierOutputSchema = z
  .object({
    agentRole: z.literal("catalyst-verifier"),
    outputId: z.string().min(1),
    runId: z.string().uuid(),
    provider: z.literal("anthropic"),
    catalysts: z.array(CatalystRecordSchema),
    abstained: z.boolean(),
    unknownFields: z.array(z.string().min(1)),
  })
  .strict();

export const SourceGuardianClaimAuditSchema = z
  .object({
    claimEvidenceId: z.string().min(1),
    verdict: SourceAuditVerdictSchema,
    passageEvidenceIds: z.array(z.string().min(1)),
    rationale: z.string().min(1),
  })
  .strict();

export const SourceGuardianOutputSchema = z
  .object({
    agentRole: z.literal("source-guardian"),
    outputId: z.string().min(1),
    runId: z.string().uuid(),
    provider: ModelProviderSchema,
    claimAudits: z.array(SourceGuardianClaimAuditSchema),
  })
  .strict();

export const AgentOutputSchema = z.discriminatedUnion("agentRole", [
  MarketResearchLeadOutputSchema,
  CatalystVerifierOutputSchema,
  SourceGuardianOutputSchema,
]);

export const CandidatePacketDraftSchema = z
  .object({
    packetId: z.string().min(1),
    runId: z.string().uuid(),
    publicationStatus: z.literal("SHADOW"),
    title: z.string().min(1),
    summary: z.string().min(1),
    materialClaimEvidenceIds: z.array(z.string().min(1)),
    sourceAuditEvidenceIds: z.array(z.string().min(1)),
    graphSha256: Sha256Schema,
    dependencyManifestSha256: Sha256Schema,
    configuredSnapshotId: z.string().uuid(),
    observedSnapshotId: z.string().uuid(),
    expiresAt: z.string().datetime({ offset: true }),
    unknownFields: z.array(z.string().min(1)),
    conflictFields: z.array(z.string().min(1)),
    packetSha256: Sha256Schema,
  })
  .strict();

export type CandidateSeed = z.infer<typeof CandidateSeedSchema>;
export type CatalystRecord = z.infer<typeof CatalystRecordSchema>;
export type AgentOutput = z.infer<typeof AgentOutputSchema>;
export type CandidatePacketDraft = z.infer<typeof CandidatePacketDraftSchema>;
