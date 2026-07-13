import { z } from "zod";

import { ModelProviderSchema, Sha256Schema } from "./version.js";

export const EvidenceKindSchema = z.enum([
  "SOURCE_VERSION",
  "PASSAGE",
  "MARKET_DATUM",
  "CLAIM",
  "SOURCE_AUDIT",
  "PACKET",
  "REPORT",
]);

export const EvidenceRelationSchema = z.enum([
  "DERIVED_FROM",
  "CITES",
  "SUPPORTS",
  "CONTRADICTS",
  "AUDITS",
  "PACKAGES",
  "SUPERSEDES",
]);

export const SourceAuditVerdictSchema = z.enum([
  "SUPPORTED",
  "PARTIALLY_SUPPORTED",
  "CONFLICTED",
  "UNSUPPORTED",
  "UNKNOWN",
]);

const EvidenceNodeShape = {
  evidenceId: z.string().min(1),
  runId: z.string().uuid().nullable(),
  sha256: Sha256Schema,
  capturedAt: z.string().datetime({ offset: true }),
  storageReference: z.string().min(1),
};

export const SourceVersionEvidenceSchema = z
  .object({
    ...EvidenceNodeShape,
    kind: z.literal("SOURCE_VERSION"),
    sourceUri: z.string().url(),
    publisher: z.string().min(1),
    mediaType: z.string().min(1),
    retrievalMethod: z.enum(["HTTP", "ALPACA_SIP", "FMP", "MANUAL_IMPORT"]),
    publishedAt: z.string().datetime({ offset: true }).nullable(),
    eventAt: z.string().datetime({ offset: true }).nullable(),
    firstKnowableAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

export const PassageEvidenceSchema = z
  .object({
    ...EvidenceNodeShape,
    kind: z.literal("PASSAGE"),
    sourceVersionId: z.string().min(1),
    locator: z.string().min(1),
    exactText: z.string().min(1),
  })
  .strict();

export const JsonScalarSchema = z.union([
  z.null(),
  z.boolean(),
  z.string(),
  z.number().finite(),
]);

export const MarketFieldSchema = z
  .object({
    name: z.string().min(1),
    value: JsonScalarSchema,
  })
  .strict();

export const MarketDatumEvidenceSchema = z
  .object({
    ...EvidenceNodeShape,
    kind: z.literal("MARKET_DATUM"),
    runId: z.string().uuid(),
    symbol: z.string().min(1),
    provider: z.enum(["ALPACA", "FMP"]),
    feed: z.enum(["SIP", "FMP"]),
    observedAt: z.string().datetime({ offset: true }),
    fields: z.array(MarketFieldSchema).min(1),
  })
  .strict();

export const ClaimEvidenceSchema = z
  .object({
    ...EvidenceNodeShape,
    kind: z.literal("CLAIM"),
    runId: z.string().uuid(),
    claimText: z.string().min(1),
    material: z.boolean(),
    authorProvider: ModelProviderSchema,
    authorManifestId: z.string().min(1),
  })
  .strict();

export const SourceAuditEvidenceSchema = z
  .object({
    ...EvidenceNodeShape,
    kind: z.literal("SOURCE_AUDIT"),
    runId: z.string().uuid(),
    claimEvidenceId: z.string().min(1),
    auditorProvider: ModelProviderSchema,
    auditorManifestId: z.string().min(1),
    verdict: SourceAuditVerdictSchema,
    passageEvidenceIds: z.array(z.string().min(1)),
    rationale: z.string().min(1),
  })
  .strict();

export const PacketEvidenceSchema = z
  .object({
    ...EvidenceNodeShape,
    kind: z.literal("PACKET"),
    runId: z.string().uuid(),
    packetContractVersion: z.string().min(1),
    graphSha256: Sha256Schema,
  })
  .strict();

export const ReportEvidenceSchema = z
  .object({
    ...EvidenceNodeShape,
    kind: z.literal("REPORT"),
    runId: z.string().uuid(),
    packetEvidenceId: z.string().min(1),
    reportContractVersion: z.string().min(1),
  })
  .strict();

export const EvidenceNodeSchema = z.discriminatedUnion("kind", [
  SourceVersionEvidenceSchema,
  PassageEvidenceSchema,
  MarketDatumEvidenceSchema,
  ClaimEvidenceSchema,
  SourceAuditEvidenceSchema,
  PacketEvidenceSchema,
  ReportEvidenceSchema,
]);

const EvidenceLinkShape = {
  linkId: z.string().min(1),
  runId: z.string().uuid(),
  sourceEvidenceId: z.string().min(1),
  targetEvidenceId: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
};

export const DerivedFromEvidenceLinkSchema = z
  .object({
    ...EvidenceLinkShape,
    relation: z.literal("DERIVED_FROM"),
    sourceKind: EvidenceKindSchema,
    targetKind: EvidenceKindSchema,
  })
  .strict();

export const CitesEvidenceLinkSchema = z
  .object({
    ...EvidenceLinkShape,
    relation: z.literal("CITES"),
    sourceKind: z.enum(["CLAIM", "PACKET", "REPORT"]),
    targetKind: z.enum(["PASSAGE", "SOURCE_VERSION"]),
  })
  .strict();

export const SupportsEvidenceLinkSchema = z
  .object({
    ...EvidenceLinkShape,
    relation: z.literal("SUPPORTS"),
    sourceKind: z.literal("PASSAGE"),
    targetKind: z.literal("CLAIM"),
  })
  .strict();

export const ContradictsEvidenceLinkSchema = z
  .object({
    ...EvidenceLinkShape,
    relation: z.literal("CONTRADICTS"),
    sourceKind: z.enum(["PASSAGE", "CLAIM"]),
    targetKind: z.literal("CLAIM"),
  })
  .strict();

export const AuditsEvidenceLinkSchema = z
  .object({
    ...EvidenceLinkShape,
    relation: z.literal("AUDITS"),
    sourceKind: z.literal("SOURCE_AUDIT"),
    targetKind: z.literal("CLAIM"),
  })
  .strict();

export const PackagesEvidenceLinkSchema = z
  .object({
    ...EvidenceLinkShape,
    relation: z.literal("PACKAGES"),
    sourceKind: z.literal("PACKET"),
    targetKind: z.enum([
      "SOURCE_VERSION",
      "PASSAGE",
      "MARKET_DATUM",
      "CLAIM",
      "SOURCE_AUDIT",
    ]),
  })
  .strict();

export const SupersedesEvidenceLinkSchema = z
  .object({
    ...EvidenceLinkShape,
    relation: z.literal("SUPERSEDES"),
    sourceKind: EvidenceKindSchema,
    targetKind: EvidenceKindSchema,
  })
  .strict();

export const EvidenceLinkSchema = z.discriminatedUnion("relation", [
  DerivedFromEvidenceLinkSchema,
  CitesEvidenceLinkSchema,
  SupportsEvidenceLinkSchema,
  ContradictsEvidenceLinkSchema,
  AuditsEvidenceLinkSchema,
  PackagesEvidenceLinkSchema,
  SupersedesEvidenceLinkSchema,
]);

export const EvidenceGraphSchema = z
  .object({
    runId: z.string().uuid(),
    nodes: z.array(EvidenceNodeSchema),
    links: z.array(EvidenceLinkSchema),
    validatorVersion: z.string().min(1),
    graphSha256: Sha256Schema,
  })
  .strict();

export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;
export type EvidenceNode = z.infer<typeof EvidenceNodeSchema>;
export type EvidenceRelation = z.infer<typeof EvidenceRelationSchema>;
export type EvidenceLink = z.infer<typeof EvidenceLinkSchema>;
export type EvidenceGraph = z.infer<typeof EvidenceGraphSchema>;
