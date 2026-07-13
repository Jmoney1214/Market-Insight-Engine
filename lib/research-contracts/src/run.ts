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

type ClassifiedProviderResponse = z.infer<
  typeof ClassifiedProviderResponseSchema
>;
type ClassifiedResponseKind = ClassifiedProviderResponse["kind"];

type AttemptedResponseEvidence = {
  checkedAt: string;
  requestStartedAt: string | null;
  responseReceivedAt: string | null;
  httpStatus: number | null;
  classifiedResponse: ClassifiedProviderResponse | null;
  responseBodySha256: string | null;
};

function addPreflightIssue(
  context: z.RefinementCtx,
  path: (string | number)[],
  message: string,
): void {
  context.addIssue({ code: z.ZodIssueCode.custom, path, message });
}

function assertNeverStatus(status: never): never {
  throw new TypeError(`Unhandled provider preflight status: ${status}`);
}

function isSuccessfulHttpStatus(status: number | null): boolean {
  return status !== null && status >= 200 && status <= 299;
}

function refineAttemptedResponseEvidence(
  result: AttemptedResponseEvidence,
  context: z.RefinementCtx,
): void {
  if (result.requestStartedAt === null || result.classifiedResponse === null) {
    addPreflightIssue(
      context,
      [],
      "attempted preflights require request timing and a classification",
    );
    return;
  }

  const classification = result.classifiedResponse.kind;
  const responseBodyPresent =
    result.classifiedResponse.redactedBodyJson !== null;
  const hasAnyResponseEvidence =
    result.responseReceivedAt !== null ||
    result.httpStatus !== null ||
    result.responseBodySha256 !== null ||
    responseBodyPresent;
  const hasCompleteResponseEvidence =
    result.responseReceivedAt !== null &&
    result.httpStatus !== null &&
    result.responseBodySha256 !== null &&
    (responseBodyPresent || classification === "EMPTY");

  if (hasAnyResponseEvidence && !hasCompleteResponseEvidence) {
    addPreflightIssue(
      context,
      [],
      "HTTP response status, timing, redacted body, and body hash must be complete",
    );
  }

  if (
    Date.parse(result.checkedAt) < Date.parse(result.requestStartedAt) ||
    (result.responseReceivedAt !== null &&
      (Date.parse(result.responseReceivedAt) <
        Date.parse(result.requestStartedAt) ||
        Date.parse(result.checkedAt) < Date.parse(result.responseReceivedAt)))
  ) {
    addPreflightIssue(
      context,
      ["responseReceivedAt"],
      "preflight timestamps must follow request, response, checked order",
    );
  }

  switch (classification) {
    case "SUCCESS":
      if (
        !hasCompleteResponseEvidence ||
        !isSuccessfulHttpStatus(result.httpStatus)
      ) {
        addPreflightIssue(
          context,
          ["classifiedResponse", "kind"],
          "SUCCESS requires a complete 2xx HTTP response",
        );
      }
      break;
    case "AUTH_ERROR":
      if (!hasCompleteResponseEvidence || result.httpStatus !== 401) {
        addPreflightIssue(
          context,
          ["classifiedResponse", "kind"],
          "AUTH_ERROR requires a complete HTTP 401 response",
        );
      }
      break;
    case "ENTITLEMENT_ERROR":
      if (
        !hasCompleteResponseEvidence ||
        (result.httpStatus !== 402 && result.httpStatus !== 403)
      ) {
        addPreflightIssue(
          context,
          ["classifiedResponse", "kind"],
          "ENTITLEMENT_ERROR requires a complete HTTP 402 or 403 response",
        );
      }
      break;
    case "RATE_LIMIT_ERROR":
      if (!hasCompleteResponseEvidence || result.httpStatus !== 429) {
        addPreflightIssue(
          context,
          ["classifiedResponse", "kind"],
          "RATE_LIMIT_ERROR requires a complete HTTP 429 response",
        );
      }
      break;
    case "PROVIDER_ERROR":
      if (
        result.httpStatus === null
          ? hasAnyResponseEvidence
          : !hasCompleteResponseEvidence || result.httpStatus < 500
      ) {
        addPreflightIssue(
          context,
          ["classifiedResponse", "kind"],
          "PROVIDER_ERROR requires either no response or a complete 5xx response",
        );
      }
      break;
    case "SCHEMA_ERROR":
      if (
        !hasCompleteResponseEvidence ||
        !isSuccessfulHttpStatus(result.httpStatus)
      ) {
        addPreflightIssue(
          context,
          ["classifiedResponse", "kind"],
          "SCHEMA_ERROR requires a complete 2xx response",
        );
      }
      break;
    case "TIMEOUT":
      if (hasAnyResponseEvidence) {
        addPreflightIssue(
          context,
          ["classifiedResponse", "kind"],
          "TIMEOUT cannot carry HTTP response evidence",
        );
      }
      break;
    case "EMPTY":
      if (
        !hasCompleteResponseEvidence ||
        !isSuccessfulHttpStatus(result.httpStatus)
      ) {
        addPreflightIssue(
          context,
          ["classifiedResponse", "kind"],
          "EMPTY requires a received, hashed 2xx response",
        );
      }
      break;
    case "UNKNOWN":
      if (
        result.httpStatus === null
          ? hasAnyResponseEvidence
          : !hasCompleteResponseEvidence ||
            isSuccessfulHttpStatus(result.httpStatus) ||
            [401, 402, 403, 429].includes(result.httpStatus) ||
            result.httpStatus >= 500
      ) {
        addPreflightIssue(
          context,
          ["classifiedResponse", "kind"],
          "UNKNOWN cannot carry a recognized provider outcome",
        );
      }
      break;
  }
}

function classificationMatchesStatus<Status extends string>(
  mapping: Record<Status, readonly ClassifiedResponseKind[] | null>,
  status: Status,
  classification: ClassifiedResponseKind | null,
): boolean {
  const allowed = mapping[status];
  return allowed === null
    ? classification === null
    : classification !== null && allowed.includes(classification);
}

export const SipPreflightStatusSchema = z.enum([
  "SIP_REALTIME",
  "SIP_DELAYED_ONLY",
  "IEX_ONLY",
  "AUTH_FAILED",
  "RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "UNKNOWN",
]);

type SipPreflightStatus = z.infer<typeof SipPreflightStatusSchema>;

const SipClassificationsByStatus = {
  SIP_REALTIME: ["SUCCESS"],
  SIP_DELAYED_ONLY: ["ENTITLEMENT_ERROR"],
  IEX_ONLY: ["ENTITLEMENT_ERROR"],
  AUTH_FAILED: ["AUTH_ERROR"],
  RATE_LIMITED: ["RATE_LIMIT_ERROR"],
  PROVIDER_UNAVAILABLE: ["PROVIDER_ERROR", "TIMEOUT"],
  UNKNOWN: ["UNKNOWN"],
} as const satisfies Record<
  SipPreflightStatus,
  readonly ClassifiedResponseKind[]
>;

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

  refineAttemptedResponseEvidence(result, context);
  if (
    !classificationMatchesStatus(
      SipClassificationsByStatus,
      result.status,
      result.classifiedResponse.kind,
    )
  ) {
    addPreflightIssue(
      context,
      ["classifiedResponse", "kind"],
      `${result.status} has an incompatible response classification`,
    );
  }

  switch (result.status) {
    case "SIP_REALTIME":
      if (result.httpStatus !== 200 || result.marketTimestamp === null) {
        addPreflightIssue(
          context,
          [],
          "SIP_REALTIME requires HTTP 200 and a returned market timestamp",
        );
      }
      break;
    case "SIP_DELAYED_ONLY":
    case "IEX_ONLY":
      if (result.httpStatus !== 403 || result.marketTimestamp !== null) {
        addPreflightIssue(
          context,
          [],
          `${result.status} requires HTTP 403 and no accepted market timestamp`,
        );
      }
      break;
    case "AUTH_FAILED":
    case "RATE_LIMITED":
    case "PROVIDER_UNAVAILABLE":
    case "UNKNOWN":
      if (result.marketTimestamp !== null) {
        addPreflightIssue(
          context,
          ["marketTimestamp"],
          `${result.status} cannot carry a successful market timestamp`,
        );
      }
      break;
    default:
      assertNeverStatus(result.status);
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

type FmpPreflightStatus = z.infer<typeof FmpPreflightStatusSchema>;

const FmpClassificationsByStatus = {
  NOT_REQUIRED: null,
  AVAILABLE: ["SUCCESS"],
  AUTH_FAILED: ["AUTH_ERROR"],
  ENTITLEMENT_FAILED: ["ENTITLEMENT_ERROR"],
  RATE_LIMITED: ["RATE_LIMIT_ERROR"],
  PROVIDER_UNAVAILABLE: ["PROVIDER_ERROR"],
  SCHEMA_INVALID: ["SCHEMA_ERROR"],
  TIMED_OUT: ["TIMEOUT"],
  UNKNOWN: ["UNKNOWN"],
} as const satisfies Record<
  FmpPreflightStatus,
  readonly ClassifiedResponseKind[] | null
>;

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

  refineAttemptedResponseEvidence(result, context);
  if (
    !classificationMatchesStatus(
      FmpClassificationsByStatus,
      result.status,
      result.classifiedResponse?.kind ?? null,
    )
  ) {
    addPreflightIssue(
      context,
      ["classifiedResponse", "kind"],
      `${result.status} has an incompatible response classification`,
    );
  }

  switch (result.status) {
    case "AVAILABLE":
    case "SCHEMA_INVALID":
      if (result.httpStatus !== 200) {
        addPreflightIssue(
          context,
          ["httpStatus"],
          `${result.status} requires HTTP 200 from the selected FMP endpoint family`,
        );
      }
      break;
    case "AUTH_FAILED":
    case "ENTITLEMENT_FAILED":
    case "RATE_LIMITED":
    case "PROVIDER_UNAVAILABLE":
    case "TIMED_OUT":
    case "UNKNOWN":
      break;
    default:
      assertNeverStatus(result.status);
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

type ModelProviderPreflightStatus = z.infer<
  typeof ModelProviderPreflightStatusSchema
>;

const ModelClassificationsByStatus = {
  AVAILABLE: ["SUCCESS"],
  AUTH_FAILED: ["AUTH_ERROR"],
  RATE_LIMITED: ["RATE_LIMIT_ERROR"],
  PROVIDER_UNAVAILABLE: ["PROVIDER_ERROR"],
  SCHEMA_INVALID: ["SCHEMA_ERROR"],
  TIMED_OUT: ["TIMEOUT"],
  UNKNOWN: ["UNKNOWN"],
} as const satisfies Record<
  ModelProviderPreflightStatus,
  readonly ClassifiedResponseKind[]
>;

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
  providerResponseId: z.string().min(1).nullable(),
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
  refineAttemptedResponseEvidence(result, context);
  if (
    !classificationMatchesStatus(
      ModelClassificationsByStatus,
      result.status,
      result.classifiedResponse.kind,
    )
  ) {
    addPreflightIssue(
      context,
      ["classifiedResponse", "kind"],
      `${result.status} has an incompatible response classification`,
    );
  }

  if (result.responseReceivedAt === null) {
    if (result.providerRequestId !== null) {
      addPreflightIssue(
        context,
        ["providerRequestId"],
        "a model probe without a provider response cannot claim a provider request ID",
      );
    }
  } else if (result.providerRequestId === null) {
    addPreflightIssue(
      context,
      ["providerRequestId"],
      "received model responses require the provider request ID",
    );
  }

  switch (result.status) {
    case "AVAILABLE":
      if (
        result.httpStatus !== 200 ||
        result.returnedModelId === null ||
        result.providerResponseId === null
      ) {
        addPreflightIssue(
          context,
          [],
          "AVAILABLE requires HTTP 200 plus returned model and response IDs",
        );
      }
      break;
    case "AUTH_FAILED":
    case "RATE_LIMITED":
    case "PROVIDER_UNAVAILABLE":
    case "SCHEMA_INVALID":
    case "TIMED_OUT":
    case "UNKNOWN":
      if (
        result.returnedModelId !== null ||
        result.providerResponseId !== null
      ) {
        addPreflightIssue(
          context,
          [],
          `${result.status} cannot claim returned model or response IDs`,
        );
      }
      break;
    default:
      assertNeverStatus(result.status);
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
