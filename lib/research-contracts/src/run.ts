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

const SipPreflightShape = {
  provider: z.literal("ALPACA_SIP"),
  checkedAt: z.string().datetime({ offset: true }),
  endpoint: z.string().url(),
  probeSymbol: z.string().min(1),
  httpStatus: z.number().int().min(100).max(599).nullable(),
  durationMs: z.number().int().nonnegative(),
  attempt: z.number().int().positive(),
  responseBodySha256: Sha256Schema.nullable(),
  marketTimestamp: z.string().datetime({ offset: true }).nullable(),
  marketSession: MarketSessionContextSchema,
};

function sipPreflightVariant<const Status extends string>(status: Status) {
  return z
    .object({
      ...SipPreflightShape,
      status: z.literal(status),
    })
    .strict();
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

export const SipRealtimePreflightSchema = z
  .object({
    ...SipPreflightShape,
    status: z.literal("SIP_REALTIME"),
    httpStatus: z.literal(200),
    responseBodySha256: Sha256Schema,
    marketTimestamp: z.string().datetime({ offset: true }),
  })
  .strict();

export const SipPreflightResultSchema = z.discriminatedUnion("status", [
  SipRealtimePreflightSchema,
  sipPreflightVariant("SIP_DELAYED_ONLY"),
  sipPreflightVariant("IEX_ONLY"),
  sipPreflightVariant("AUTH_FAILED"),
  sipPreflightVariant("RATE_LIMITED"),
  sipPreflightVariant("PROVIDER_UNAVAILABLE"),
  sipPreflightVariant("UNKNOWN"),
]);

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
  checkedAt: z.string().datetime({ offset: true }),
  endpointFamily: FmpEndpointFamilySchema,
  endpoint: z.string().url(),
  probeSymbol: z.string().min(1),
  httpStatus: z.number().int().min(100).max(599).nullable(),
  durationMs: z.number().int().nonnegative(),
  attempt: z.number().int().positive(),
  responseBodySha256: Sha256Schema.nullable(),
};

function fmpPreflightVariant<const Status extends string>(status: Status) {
  return z
    .object({
      ...FmpRequiredShape,
      status: z.literal(status),
    })
    .strict();
}

export const FmpAvailablePreflightSchema = z
  .object({
    ...FmpRequiredShape,
    status: z.literal("AVAILABLE"),
    httpStatus: z.number().int().min(200).max(299),
    responseBodySha256: Sha256Schema,
  })
  .strict();

export const FmpNotRequiredPreflightSchema = z
  .object({
    provider: z.literal("FMP"),
    status: z.literal("NOT_REQUIRED"),
    checkedAt: z.string().datetime({ offset: true }),
    endpointFamily: z.null(),
    endpoint: z.null(),
    probeSymbol: z.null(),
    httpStatus: z.null(),
    durationMs: z.literal(0),
    attempt: z.literal(0),
    responseBodySha256: z.null(),
  })
  .strict();

export const FmpPreflightResultSchema = z.discriminatedUnion("status", [
  FmpNotRequiredPreflightSchema,
  FmpAvailablePreflightSchema,
  fmpPreflightVariant("AUTH_FAILED"),
  fmpPreflightVariant("ENTITLEMENT_FAILED"),
  fmpPreflightVariant("RATE_LIMITED"),
  fmpPreflightVariant("PROVIDER_UNAVAILABLE"),
  fmpPreflightVariant("SCHEMA_INVALID"),
  fmpPreflightVariant("TIMED_OUT"),
  fmpPreflightVariant("UNKNOWN"),
]);

export const ProviderPreflightResultSchema = z.union([
  SipPreflightResultSchema,
  FmpPreflightResultSchema,
]);

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
