import { z } from "zod";

import { PrincipalSchema } from "./auth.js";
import {
  FmpPreflightStatusSchema,
  ResearchOutcomeSchema,
  RunFailureReasonSchema,
  RunStateSchema,
  SipPreflightStatusSchema,
} from "./run.js";
import { ModelProviderSchema, Sha256Schema } from "./version.js";

export const TraceKindSchema = z.enum([
  "RUN_STATE_CHANGED",
  "PROVIDER_PREFLIGHT",
  "AGENT_STARTED",
  "MODEL_CALL_INTENT",
  "MODEL_REQUEST",
  "MODEL_RESPONSE",
  "TOOL_CALL_INTENT",
  "TOOL_REQUEST",
  "TOOL_RESPONSE",
  "RETRY_SCHEDULED",
  "ERROR",
  "GRADER_REQUEST",
  "GRADER_RESULT",
  "GATE_RESULT",
  "AGENT_FINISHED",
]);

export const TraceStatusSchema = z.enum([
  "PENDING",
  "STARTED",
  "SUCCEEDED",
  "FAILED",
  "BLOCKED",
  "UNKNOWN_EXTERNAL_OUTCOME",
]);

export const ModelUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative(),
    cacheWriteTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative(),
  })
  .strict();

export const TraceCostSchema = z
  .object({
    currency: z.literal("USD"),
    providerReportedMicroUsd: z.number().int().nonnegative().nullable(),
    computedMicroUsd: z.number().int().nonnegative(),
    priceCatalogVersion: z.string().min(1),
  })
  .strict();

export const TraceErrorSchema = z
  .object({
    classification: z.enum([
      "AUTH",
      "ENTITLEMENT",
      "RATE_LIMIT",
      "PROVIDER",
      "SCHEMA",
      "TIMEOUT",
      "POLICY",
      "INTERNAL",
      "UNKNOWN",
    ]),
    code: z.string().min(1),
    message: z.string(),
    retryable: z.boolean(),
  })
  .strict();

const TraceEventShape = {
  traceEventId: z.string().uuid(),
  runId: z.string().uuid(),
  sequence: z.number().int().positive(),
  traceId: z.string().min(1),
  spanId: z.string().min(1),
  parentSpanId: z.string().min(1).nullable(),
  principal: PrincipalSchema,
  versionSnapshotId: z.string().uuid(),
  attempt: z.number().int().positive(),
  status: TraceStatusSchema,
  name: z.string().min(1),
  requestedAt: z.string().datetime({ offset: true }),
  respondedAt: z.string().datetime({ offset: true }).nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  providerRequestId: z.string().min(1).nullable(),
  callId: z.string().min(1).nullable(),
  payloadSha256: Sha256Schema,
  usage: ModelUsageSchema.nullable(),
  cost: TraceCostSchema.nullable(),
  error: TraceErrorSchema.nullable(),
  evidenceIds: z.array(z.string().min(1)),
};

const RunStateChangedPayloadSchema = z
  .object({
    fromState: RunStateSchema.nullable(),
    toState: RunStateSchema,
    outcome: ResearchOutcomeSchema.nullable(),
    failureReason: RunFailureReasonSchema.nullable(),
  })
  .strict();

const ProviderPreflightPayloadSchema = z
  .object({
    provider: z.enum(["ALPACA_SIP", "FMP", "OPENAI", "ANTHROPIC"]),
    status: z.union([SipPreflightStatusSchema, FmpPreflightStatusSchema]),
    endpoint: z.string().url().nullable(),
    probeSymbol: z.string().min(1).nullable(),
    redactedResponseJson: z.string().min(1).nullable(),
    responseBodySha256: Sha256Schema.nullable(),
  })
  .strict();

const AgentLifecyclePayloadSchema = z
  .object({
    manifestId: z.string().min(1),
    manifestVersion: z.string().min(1),
    redactedOutputJson: z.string().min(1).nullable(),
    outputSha256: Sha256Schema.nullable(),
  })
  .strict();

const ModelIntentPayloadSchema = z
  .object({
    provider: ModelProviderSchema,
    requestedModelId: z.string().min(1),
    attemptId: z.string().min(1),
    redactedRequestJson: z.string().min(1),
    requestSha256: Sha256Schema,
  })
  .strict();

const ModelRequestPayloadSchema = z
  .object({
    provider: ModelProviderSchema,
    requestedModelId: z.string().min(1),
    redactedMessagesJson: z.string().min(1),
    redactedToolSchemasJson: z.string().min(1),
    messagesSha256: Sha256Schema,
    toolSchemaHashes: z.array(Sha256Schema),
  })
  .strict();

const ModelResponsePayloadSchema = z
  .object({
    provider: ModelProviderSchema,
    requestedModelId: z.string().min(1),
    returnedModelId: z.string().min(1),
    providerResponseId: z.string().min(1),
    stopReason: z.string().min(1),
    redactedResponseJson: z.string().min(1),
    outputSha256: Sha256Schema,
  })
  .strict();

const ToolIntentPayloadSchema = z
  .object({
    toolId: z.string().min(1),
    toolSchemaVersion: z.string().min(1),
    attemptId: z.string().min(1),
    redactedArgumentsJson: z.string().min(1),
    argumentsSha256: Sha256Schema,
  })
  .strict();

const ToolRequestPayloadSchema = z
  .object({
    toolId: z.string().min(1),
    toolSchemaVersion: z.string().min(1),
    redactedArgumentsJson: z.string().min(1),
    argumentsSha256: Sha256Schema,
  })
  .strict();

const ToolResponsePayloadSchema = z
  .object({
    toolId: z.string().min(1),
    toolSchemaVersion: z.string().min(1),
    redactedResultJson: z.string().min(1),
    resultSha256: Sha256Schema,
  })
  .strict();

const RetryPayloadSchema = z
  .object({
    target: z.enum(["PROVIDER_PREFLIGHT", "MODEL", "TOOL", "GRADER"]),
    delayMs: z.number().int().nonnegative(),
    nextAttempt: z.number().int().positive(),
    errorCode: z.string().min(1),
  })
  .strict();

const ErrorPayloadSchema = z
  .object({
    code: z.string().min(1),
    classification: TraceErrorSchema.shape.classification,
    messageSha256: Sha256Schema,
  })
  .strict();

const GraderPayloadSchema = z
  .object({
    graderManifestId: z.string().min(1),
    caseRevisionId: z.string().min(1),
    rubricSha256: Sha256Schema,
    redactedResultJson: z.string().min(1).nullable(),
    resultSha256: Sha256Schema.nullable(),
  })
  .strict();

const GatePayloadSchema = z
  .object({
    gateId: z.string().min(1),
    verdict: z.enum(["PASS", "FAIL", "LOCKED"]),
    reasonCodes: z.array(z.string().min(1)),
  })
  .strict();

function traceVariant<
  const Kind extends z.infer<typeof TraceKindSchema>,
  Payload extends z.ZodTypeAny,
>(kind: Kind, payload: Payload) {
  return z
    .object({
      ...TraceEventShape,
      kind: z.literal(kind),
      payload,
    })
    .strict();
}

export const RunStateChangedTraceSchema = traceVariant(
  "RUN_STATE_CHANGED",
  RunStateChangedPayloadSchema,
);
export const ProviderPreflightTraceSchema = traceVariant(
  "PROVIDER_PREFLIGHT",
  ProviderPreflightPayloadSchema,
);
export const AgentStartedTraceSchema = traceVariant(
  "AGENT_STARTED",
  AgentLifecyclePayloadSchema,
);
export const ModelCallIntentTraceSchema = traceVariant(
  "MODEL_CALL_INTENT",
  ModelIntentPayloadSchema,
);
export const ModelRequestTraceSchema = traceVariant(
  "MODEL_REQUEST",
  ModelRequestPayloadSchema,
);
export const ModelResponseTraceSchema = traceVariant(
  "MODEL_RESPONSE",
  ModelResponsePayloadSchema,
);
export const ToolCallIntentTraceSchema = traceVariant(
  "TOOL_CALL_INTENT",
  ToolIntentPayloadSchema,
);
export const ToolRequestTraceSchema = traceVariant(
  "TOOL_REQUEST",
  ToolRequestPayloadSchema,
);
export const ToolResponseTraceSchema = traceVariant(
  "TOOL_RESPONSE",
  ToolResponsePayloadSchema,
);
export const RetryScheduledTraceSchema = traceVariant(
  "RETRY_SCHEDULED",
  RetryPayloadSchema,
);
export const ErrorTraceSchema = traceVariant("ERROR", ErrorPayloadSchema);
export const GraderRequestTraceSchema = traceVariant(
  "GRADER_REQUEST",
  GraderPayloadSchema,
);
export const GraderResultTraceSchema = traceVariant(
  "GRADER_RESULT",
  GraderPayloadSchema,
);
export const GateResultTraceSchema = traceVariant(
  "GATE_RESULT",
  GatePayloadSchema,
);
export const AgentFinishedTraceSchema = traceVariant(
  "AGENT_FINISHED",
  AgentLifecyclePayloadSchema,
);

export const TraceEventSchema = z.discriminatedUnion("kind", [
  RunStateChangedTraceSchema,
  ProviderPreflightTraceSchema,
  AgentStartedTraceSchema,
  ModelCallIntentTraceSchema,
  ModelRequestTraceSchema,
  ModelResponseTraceSchema,
  ToolCallIntentTraceSchema,
  ToolRequestTraceSchema,
  ToolResponseTraceSchema,
  RetryScheduledTraceSchema,
  ErrorTraceSchema,
  GraderRequestTraceSchema,
  GraderResultTraceSchema,
  GateResultTraceSchema,
  AgentFinishedTraceSchema,
]);

export type TraceKind = z.infer<typeof TraceKindSchema>;
export type TraceEvent = z.infer<typeof TraceEventSchema>;
