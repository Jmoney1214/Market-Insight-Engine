import { z } from "zod";

import { Sha256Schema } from "./version.js";

export const RunModeSchema = z.enum([
  "LIVE",
  "LIVE_SMOKE",
  "REPLAY",
  "EVALUATION",
]);

export const RunStateSchema = z.enum([
  "RECEIVED",
  "PREFLIGHT",
  "RUNNING",
  "GRADING",
  "GATE_CHECK",
  "TERMINAL",
]);

export const ResearchOutcomeSchema = z.enum([
  "COMPLETE",
  "PARTIAL",
  "BLOCKED",
  "FAILED",
  "CANCELED",
  "TIMED_OUT",
  "BUDGET_EXCEEDED",
]);

export const RunFailureReasonSchema = z.enum([
  "BLOCKED_SIP_UNAVAILABLE",
  "BLOCKED_FMP_UNAVAILABLE",
  "BLOCKED_MODEL_UNAVAILABLE",
  "BLOCKED_CRITICAL_ERROR",
  "BLOCKED_BUDGET_EXCEEDED",
  "BLOCKED_TRACE_INCOMPLETE",
  "PARTIAL_INCOMPLETE",
  "FAILED_INTERNAL",
  "CANCELED_BY_CALLER",
  "TIMED_OUT",
]);

export const MarketSessionContextSchema = z
  .object({
    session: z.enum(["PREMARKET", "REGULAR", "AFTER_HOURS", "CLOSED"]),
    calendarDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    evaluatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const ClassifiedProviderResponseSchema = z
  .object({
    kind: z.enum([
      "SUCCESS",
      "AUTH_ERROR",
      "ENTITLEMENT_ERROR",
      "RATE_LIMIT_ERROR",
      "PROVIDER_ERROR",
      "SCHEMA_ERROR",
      "TIMEOUT",
      "EMPTY",
      "UNKNOWN",
    ]),
    redactedBodyJson: z.string().min(1).nullable(),
  })
  .strict();

export const SipPreflightStatusSchema = z.enum([
  "SIP_REALTIME",
  "SIP_DELAYED_ONLY",
  "IEX_ONLY",
  "AUTH_FAILED",
  "RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "UNKNOWN",
]);

const AlpacaSipPreflightObjectSchema = z
  .object({
    provider: z.literal("ALPACA_SIP"),
    status: SipPreflightStatusSchema,
    checkedAt: z.string().datetime({ offset: true }),
    requestStartedAt: z.string().datetime({ offset: true }),
    responseReceivedAt: z.string().datetime({ offset: true }).nullable(),
    endpoint: z.string().url(),
    feed: z.literal("sip"),
    probeSymbol: z.string().min(1),
    httpStatus: z.number().int().min(100).max(599).nullable(),
    durationMs: z.number().int().nonnegative(),
    attempt: z.number().int().positive(),
    classifiedResponse: ClassifiedProviderResponseSchema,
    responseBodySha256: Sha256Schema.nullable(),
    marketTimestamp: z.string().datetime({ offset: true }).nullable(),
    marketSession: MarketSessionContextSchema,
  })
  .strict();

type AlpacaSipPreflight = z.infer<typeof AlpacaSipPreflightObjectSchema>;

function hasSipFeed(endpoint: string): boolean {
  return new URL(endpoint).searchParams.get("feed") === "sip";
}

function refineAlpacaSipPreflight(
  result: AlpacaSipPreflight,
  context: z.RefinementCtx,
): void {
  if (!hasSipFeed(result.endpoint)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endpoint"],
      message: "Alpaca SIP probes must explicitly request feed=sip",
    });
  }

  if (result.status === "SIP_REALTIME") {
    if (
      result.httpStatus !== 200 ||
      result.responseReceivedAt === null ||
      result.classifiedResponse.kind !== "SUCCESS" ||
      result.responseBodySha256 === null ||
      result.marketTimestamp === null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "SIP_REALTIME requires a complete successful SIP response and market timestamp",
      });
    }
  }
}

export const SipPreflightResultSchema =
  AlpacaSipPreflightObjectSchema.superRefine(refineAlpacaSipPreflight);

export const SipRealtimePreflightSchema =
  AlpacaSipPreflightObjectSchema.superRefine((result, context) => {
    if (result.status !== "SIP_REALTIME") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "expected SIP_REALTIME",
      });
    }
    refineAlpacaSipPreflight(result, context);
  });

export const FmpEndpointFamilySchema = z.enum(["profile", "news", "quote"]);
export const FmpPreflightStatusSchema = z.enum([
  "NOT_REQUIRED",
  "AVAILABLE",
  "AUTH_FAILED",
  "ENTITLEMENT_FAILED",
  "RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "SCHEMA_INVALID",
  "TIMED_OUT",
  "UNKNOWN",
]);

const FmpRequiredShape = {
  provider: z.literal("FMP"),
  status: FmpPreflightStatusSchema,
  checkedAt: z.string().datetime({ offset: true }),
  requestStartedAt: z.string().datetime({ offset: true }).nullable(),
  responseReceivedAt: z.string().datetime({ offset: true }).nullable(),
  endpointFamily: FmpEndpointFamilySchema.nullable(),
  endpoint: z.string().url().nullable(),
  probeSymbol: z.string().min(1).nullable(),
  httpStatus: z.number().int().min(100).max(599).nullable(),
  durationMs: z.number().int().nonnegative(),
  attempt: z.number().int().nonnegative(),
  classifiedResponse: ClassifiedProviderResponseSchema.nullable(),
  responseBodySha256: Sha256Schema.nullable(),
};

const FmpPreflightObjectSchema = z
  .object({
    ...FmpRequiredShape,
  })
  .strict();

type FmpPreflight = z.infer<typeof FmpPreflightObjectSchema>;

function refineFmpPreflight(
  result: FmpPreflight,
  context: z.RefinementCtx,
): void {
  if (result.status === "NOT_REQUIRED") {
    if (
      result.requestStartedAt !== null ||
      result.responseReceivedAt !== null ||
      result.endpointFamily !== null ||
      result.endpoint !== null ||
      result.probeSymbol !== null ||
      result.httpStatus !== null ||
      result.durationMs !== 0 ||
      result.attempt !== 0 ||
      result.classifiedResponse !== null ||
      result.responseBodySha256 !== null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "NOT_REQUIRED cannot claim an FMP request or response",
      });
    }
    return;
  }

  if (
    result.requestStartedAt === null ||
    result.endpointFamily === null ||
    result.endpoint === null ||
    result.probeSymbol === null ||
    result.attempt < 1 ||
    result.classifiedResponse === null
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "required FMP probes require complete request evidence",
    });
  }

  if (
    result.status === "AVAILABLE" &&
    (result.httpStatus === null ||
      result.httpStatus < 200 ||
      result.httpStatus > 299 ||
      result.responseReceivedAt === null ||
      result.classifiedResponse?.kind !== "SUCCESS" ||
      result.responseBodySha256 === null)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "AVAILABLE requires a complete successful FMP response",
    });
  }
}

export const FmpPreflightResultSchema =
  FmpPreflightObjectSchema.superRefine(refineFmpPreflight);

export const FmpAvailablePreflightSchema = FmpPreflightObjectSchema.superRefine(
  (result, context) => {
    if (result.status !== "AVAILABLE") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "expected AVAILABLE",
      });
    }
    refineFmpPreflight(result, context);
  },
);

export const FmpNotRequiredPreflightSchema =
  FmpPreflightObjectSchema.superRefine((result, context) => {
    if (result.status !== "NOT_REQUIRED") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "expected NOT_REQUIRED",
      });
    }
    refineFmpPreflight(result, context);
  });

export const ModelProviderPreflightStatusSchema = z.enum([
  "AVAILABLE",
  "AUTH_FAILED",
  "RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "SCHEMA_INVALID",
  "TIMED_OUT",
  "UNKNOWN",
]);

const ModelProviderPreflightShape = {
  status: ModelProviderPreflightStatusSchema,
  checkedAt: z.string().datetime({ offset: true }),
  requestStartedAt: z.string().datetime({ offset: true }),
  responseReceivedAt: z.string().datetime({ offset: true }).nullable(),
  endpoint: z.string().url(),
  requestedModelId: z.string().min(1),
  returnedModelId: z.string().min(1).nullable(),
  httpStatus: z.number().int().min(100).max(599).nullable(),
  durationMs: z.number().int().nonnegative(),
  attempt: z.number().int().positive(),
  providerRequestId: z.string().min(1).nullable(),
  classifiedResponse: ClassifiedProviderResponseSchema,
  responseBodySha256: Sha256Schema.nullable(),
};

const OpenAiPreflightObjectSchema = z
  .object({
    provider: z.literal("OPENAI"),
    ...ModelProviderPreflightShape,
  })
  .strict();

const AnthropicPreflightObjectSchema = z
  .object({
    provider: z.literal("ANTHROPIC"),
    ...ModelProviderPreflightShape,
  })
  .strict();

type ModelProviderPreflight =
  | z.infer<typeof OpenAiPreflightObjectSchema>
  | z.infer<typeof AnthropicPreflightObjectSchema>;

function refineModelProviderPreflight(
  result: ModelProviderPreflight,
  context: z.RefinementCtx,
): void {
  if (
    result.status === "AVAILABLE" &&
    (result.httpStatus === null ||
      result.httpStatus < 200 ||
      result.httpStatus > 299 ||
      result.responseReceivedAt === null ||
      result.returnedModelId === null ||
      result.providerRequestId === null ||
      result.classifiedResponse.kind !== "SUCCESS" ||
      result.responseBodySha256 === null)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "AVAILABLE requires a complete successful model response",
    });
  }
}

export const OpenAiPreflightResultSchema =
  OpenAiPreflightObjectSchema.superRefine(refineModelProviderPreflight);
export const AnthropicPreflightResultSchema =
  AnthropicPreflightObjectSchema.superRefine(refineModelProviderPreflight);

const DiscriminatedProviderPreflightResultSchema = z.discriminatedUnion(
  "provider",
  [
    AlpacaSipPreflightObjectSchema,
    FmpPreflightObjectSchema,
    OpenAiPreflightObjectSchema,
    AnthropicPreflightObjectSchema,
  ],
);

export const ProviderPreflightResultSchema =
  DiscriminatedProviderPreflightResultSchema.superRefine((result, context) => {
    switch (result.provider) {
      case "ALPACA_SIP":
        refineAlpacaSipPreflight(result, context);
        break;
      case "FMP":
        refineFmpPreflight(result, context);
        break;
      case "OPENAI":
      case "ANTHROPIC":
        refineModelProviderPreflight(result, context);
        break;
    }
  });

export const ResearchRunSchema = z
  .object({
    runId: z.string().uuid(),
    idempotencyKey: z.string().min(1),
    requestId: z.string().min(1),
    principalId: z.string().min(1),
    seedId: z.string().min(1),
    parentRunId: z.string().uuid().nullable(),
    attempt: z.number().int().positive(),
    mode: RunModeSchema,
    state: RunStateSchema,
    outcome: ResearchOutcomeSchema.nullable(),
    failureReason: RunFailureReasonSchema.nullable(),
    releaseFingerprintSha256: Sha256Schema,
    inputContractId: z.string().min(1),
    inputContractVersion: z.string().min(1),
    inputSha256: Sha256Schema,
    startedAt: z.string().datetime({ offset: true }),
    finishedAt: z.string().datetime({ offset: true }).nullable(),
    rowVersion: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((run, context) => {
    if (run.state === "TERMINAL") {
      if (run.outcome === null || run.finishedAt === null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "terminal runs require outcome and finishedAt",
        });
      }
      if (run.outcome === "COMPLETE" && run.failureReason !== null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["failureReason"],
          message: "complete runs cannot carry a failure reason",
        });
      }
      if (
        run.outcome !== null &&
        run.outcome !== "COMPLETE" &&
        run.failureReason === null
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["failureReason"],
          message: "abnormal terminal runs require a failure reason",
        });
      }
      return;
    }

    if (
      run.outcome !== null ||
      run.failureReason !== null ||
      run.finishedAt !== null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "nonterminal runs cannot carry terminal fields",
      });
    }
  });

export type RunMode = z.infer<typeof RunModeSchema>;
export type RunState = z.infer<typeof RunStateSchema>;
export type ResearchOutcome = z.infer<typeof ResearchOutcomeSchema>;
export type RunFailureReason = z.infer<typeof RunFailureReasonSchema>;
export type SipPreflightResult = z.infer<typeof SipPreflightResultSchema>;
export type FmpPreflightResult = z.infer<typeof FmpPreflightResultSchema>;
export type ProviderPreflightResult = z.infer<
  typeof ProviderPreflightResultSchema
>;
export type ResearchRun = z.infer<typeof ResearchRunSchema>;
