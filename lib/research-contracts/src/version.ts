import { z } from "zod";

export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const ModelProviderSchema = z.enum(["openai", "anthropic"]);

export const RuntimeVersionSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1),
  })
  .strict();

export const ManifestVersionSchema = z
  .object({
    manifestId: z.string().min(1),
    version: z.string().min(1),
    sha256: Sha256Schema,
  })
  .strict();

export const ModelVersionSchema = z
  .object({
    provider: ModelProviderSchema,
    requestedModelId: z.string().min(1),
    returnedModelPolicy: z.enum(["EXACT", "ALLOWLIST"]),
    allowedReturnedModelIds: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const ArtifactVersionSchema = z
  .object({
    artifactId: z.string().min(1),
    version: z.string().min(1),
    sha256: Sha256Schema,
  })
  .strict();

export const ToolVersionSchema = z
  .object({
    toolId: z.string().min(1),
    schemaVersion: z.string().min(1),
    implementationVersion: z.string().min(1),
    schemaSha256: Sha256Schema,
  })
  .strict();

export const ContractVersionSchema = z
  .object({
    contractId: z.string().min(1),
    version: z.string().min(1),
    sha256: Sha256Schema,
  })
  .strict();

export const PolicyVersionSchema = z
  .object({
    policyId: z.string().min(1),
    version: z.string().min(1),
    sha256: Sha256Schema,
  })
  .strict();

export const PriceCatalogVersionSchema = z
  .object({
    catalogId: z.string().min(1),
    version: z.string().min(1),
    sha256: Sha256Schema,
  })
  .strict();

export const BehaviorConfigHashSchema = z
  .object({
    configId: z.string().min(1),
    sha256: Sha256Schema,
  })
  .strict();

export const ConfiguredVersionSnapshotSchema = z
  .object({
    snapshotKind: z.literal("CONFIGURED"),
    snapshotId: z.string().uuid(),
    runId: z.string().uuid(),
    capturedAt: z.string().datetime({ offset: true }),
    gitCommit: z.string().regex(/^[a-f0-9]{7,64}$/),
    runtimeVersions: z.array(RuntimeVersionSchema).min(1),
    manifest: ManifestVersionSchema,
    models: z.array(ModelVersionSchema).min(1),
    prompt: ArtifactVersionSchema,
    skills: z.array(ArtifactVersionSchema).min(1),
    tools: z.array(ToolVersionSchema).min(1),
    inputContract: ContractVersionSchema,
    outputContract: ContractVersionSchema,
    sourcePolicy: PolicyVersionSchema,
    entityResolutionPolicy: PolicyVersionSchema,
    releasePolicy: PolicyVersionSchema,
    evalSuite: ArtifactVersionSchema,
    priceCatalog: PriceCatalogVersionSchema,
    behaviorConfigHashes: z.array(BehaviorConfigHashSchema),
    releaseFingerprintSha256: Sha256Schema,
  })
  .strict();

export const ObservedModelVersionSchema = z
  .object({
    provider: ModelProviderSchema,
    requestedModelId: z.string().min(1),
    returnedModelId: z.string().min(1),
    providerResponseId: z.string().min(1),
    providerRequestId: z.string().min(1).nullable(),
    resolutionSatisfied: z.boolean(),
  })
  .strict();

export const ObservedVersionSnapshotSchema = z
  .object({
    snapshotKind: z.literal("OBSERVED"),
    snapshotId: z.string().uuid(),
    runId: z.string().uuid(),
    configuredSnapshotId: z.string().uuid(),
    capturedAt: z.string().datetime({ offset: true }),
    models: z.array(ObservedModelVersionSchema),
    observationSha256: Sha256Schema,
  })
  .strict();

export const RunVersionSnapshotSchema = z.discriminatedUnion("snapshotKind", [
  ConfiguredVersionSnapshotSchema,
  ObservedVersionSnapshotSchema,
]);

export type Sha256 = z.infer<typeof Sha256Schema>;
export type ModelProvider = z.infer<typeof ModelProviderSchema>;
export type ConfiguredVersionSnapshot = z.infer<
  typeof ConfiguredVersionSnapshotSchema
>;
export type ObservedVersionSnapshot = z.infer<
  typeof ObservedVersionSnapshotSchema
>;
export type RunVersionSnapshot = z.infer<typeof RunVersionSnapshotSchema>;
