import { randomUUID } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type {
  DbVerifiedIdentity,
  IdempotencyTerminal,
  VerifiedControlPlaneContext,
} from "@workspace/db/control-plane";
import {
  authenticateRequest,
  verifyStepUpCredential,
} from "./credentialVerifier.js";
import {
  canonicalRequestHash,
  readIdempotencyKey,
} from "./idempotency.js";
import { authorizeOperation } from "./resourcePolicy.js";
import { resolveRoutePolicy } from "./routePolicy.js";
import {
  RequestAuthError,
  type AuthRuntime,
  type PrincipalContext,
} from "./types.js";
import { newOpaqueToken, setBrowserSessionCookies } from "./sessions.js";

type FinalizationState = {
  terminal?: Omit<IdempotencyTerminal, "responseStatus" | "responseBody">;
};

type IdempotencyReplayOverride = Readonly<{
  responseStatus: number;
  responseBody: unknown;
}>;

function identityFromContext(context: PrincipalContext): DbVerifiedIdentity {
  return {
    principalId: context.principal.principalId,
    credentialId: context.credentialId,
    principalKind: context.principal.kind,
    subject: context.principal.subject,
    scopes: context.effectiveScopes,
    ...(context.principal.servicePrincipalId
      ? { servicePrincipalId: context.principal.servicePrincipalId }
      : {}),
    ...(context.principal.manifestId
      ? { manifestId: context.principal.manifestId }
      : {}),
    ...(context.principal.manifestVersion
      ? { manifestVersion: context.principal.manifestVersion }
      : {}),
    ...(context.sessionId ? { sessionId: context.sessionId } : {}),
  };
}

function jsonBody(value: unknown): unknown {
  if (value === undefined) return {};
  if (Buffer.isBuffer(value)) return { base64: value.toString("base64") };
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return { body: value };
    }
  }
  return value;
}

function errorFields(body: unknown): { errorCode?: string; errorMessage?: string } {
  if (!body || typeof body !== "object") return {};
  const value = body as Record<string, unknown>;
  return {
    ...(typeof value["code"] === "string" ? { errorCode: value["code"] } : {}),
    ...(typeof value["error"] === "string"
      ? { errorMessage: value["error"] }
      : {}),
  };
}

function installResponseFinalizer(
  res: Response,
  runtime: AuthRuntime,
  context: VerifiedControlPlaneContext,
  requestId: string,
  startedAt: number,
  state: FinalizationState,
): void {
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);
  let bypass = false;
  let finalizing = false;

  const finalize = async (
    body: unknown,
    send: () => Response,
  ): Promise<void> => {
    if (finalizing) return;
    finalizing = true;
    const normalized = jsonBody(body);
    const status = res.statusCode;
    const errors = errorFields(normalized);
    const replayOverride = res.locals["idempotencyReplayOverride"] as
      | IdempotencyReplayOverride
      | undefined;
    try {
      await runtime.repository.completeRequest(
        context,
        {
          requestId,
          responseStatus: status,
          latencyMs: Math.max(0, Date.now() - startedAt),
          ...errors,
        },
        state.terminal
          ? {
              ...state.terminal,
              responseStatus: replayOverride?.responseStatus ?? status,
              responseBody: replayOverride?.responseBody ?? normalized,
            }
          : undefined,
      );
      bypass = true;
      send();
    } catch (error) {
      reqLog(res)?.error({ err: error, requestId }, "Request completion audit failed");
      bypass = true;
      res.status(503);
      originalJson({
        error: "Request audit is unavailable",
        code: "AUDIT_UNAVAILABLE",
      });
    }
  };

  res.json = function finalizeJson(body: unknown): Response {
    if (bypass) return originalJson(body);
    void finalize(body, () => originalJson(body));
    return res;
  };
  res.send = function finalizeSend(body?: unknown): Response {
    if (bypass) return originalSend(body);
    void finalize(body, () => originalSend(body));
    return res;
  };
}

function reqLog(res: Response): Request["log"] | undefined {
  return (res.req as Request | undefined)?.log;
}

async function startAudit(
  runtime: AuthRuntime,
  req: Request,
  requestId: string,
  route: string,
  authOutcome: "AUTHENTICATED" | "UNAUTHENTICATED" | "REJECTED",
  context?: PrincipalContext,
): Promise<void> {
  await runtime.repository.recordRequestStart({
    requestId,
    method: req.method.toUpperCase(),
    route: `/api${route}`,
    authOutcome,
    ...(context ? { identity: identityFromContext(context) } : {}),
  });
}

function sendAuditUnavailable(res: Response): void {
  res.status(503).json({
    error: "Request audit is unavailable",
    code: "AUDIT_UNAVAILABLE",
  });
}

function databaseErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : null;
}

export function createAuthenticationMiddleware(
  runtime: AuthRuntime,
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const policy = resolveRoutePolicy(req);
    if (!policy) {
      res.status(404).json({ error: "API route not found", code: "ROUTE_NOT_FOUND" });
      return;
    }
    if (policy.auth === "public") {
      next();
      return;
    }

    const requestId = randomUUID();
    const startedAt = Date.now();
    let principal: PrincipalContext;
    try {
      principal = await authenticateRequest(
        req,
        policy,
        runtime.repository,
        requestId,
        runtime.allowedOrigins,
      );
    } catch (error) {
      if (!(error instanceof RequestAuthError)) {
        req.log?.error({ err: error, requestId }, "Credential verification failed");
        sendAuditUnavailable(res);
        return;
      }
      try {
        await startAudit(
          runtime,
          req,
          requestId,
          policy.path,
          error.status === 403 ? "REJECTED" : "UNAUTHENTICATED",
        );
      } catch (auditError) {
        req.log?.error({ err: auditError, requestId }, "Authentication audit failed");
        sendAuditUnavailable(res);
        return;
      }
      installResponseFinalizer(
        res,
        runtime,
        { requestId },
        requestId,
        startedAt,
        {},
      );
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }

    try {
      await startAudit(
        runtime,
        req,
        requestId,
        policy.path,
        "AUTHENTICATED",
        principal,
      );
    } catch (error) {
      req.log?.error({ err: error, requestId }, "Authenticated request audit failed");
      sendAuditUnavailable(res);
      return;
    }

    const dbContext: VerifiedControlPlaneContext = {
      requestId,
      principalId: principal.principal.principalId,
      credentialId: principal.credentialId,
    };
    const finalizationState: FinalizationState = {};
    installResponseFinalizer(
      res,
      runtime,
      dbContext,
      requestId,
      startedAt,
      finalizationState,
    );

    if (!authorizeOperation(policy, principal)) {
      res.status(403).json({
        error: "Principal is not authorized for this operation",
        code: "AUTH_FORBIDDEN",
      });
      return;
    }

    if (policy.stepUp) {
      try {
        const stepUpCredentialId = await verifyStepUpCredential(
          req,
          runtime.repository,
          principal,
        );
        const governance = runtime.governance;
        if (!governance || !principal.sessionId) {
          throw new Error("Governance step-up runtime is unavailable");
        }
        const sessionToken = newOpaqueToken();
        const csrfToken = newOpaqueToken();
        const rotatedSessionId = await governance.repository.rotateBrowserSession(
          dbContext,
          principal.sessionId,
          sessionToken,
          csrfToken,
        );
        setBrowserSessionCookies(res, sessionToken, csrfToken);
        principal = { ...principal, sessionId: rotatedSessionId };
        req.stepUpCredentialId = stepUpCredentialId;
      } catch (error) {
        if (error instanceof RequestAuthError) {
          res.status(error.status).json({ error: error.message, code: error.code });
          return;
        }
        req.log?.error({ err: error, requestId }, "Governance step-up failed");
        res.status(503).json({
          error: "Governance step-up is unavailable",
          code: "AUDIT_UNAVAILABLE",
        });
        return;
      }
    }

    if (policy.idempotency === "required") {
      const key = readIdempotencyKey(req);
      if (!key) {
        res.status(400).json({
          error: "A valid Idempotency-Key header is required",
          code: "IDEMPOTENCY_KEY_REQUIRED",
        });
        return;
      }
      const canonicalInputHash = canonicalRequestHash(req, policy.operationId);
      try {
        const claim = await runtime.repository.claimIdempotency(
          dbContext,
          policy.operationId,
          key,
          canonicalInputHash,
        );
        if (claim.status === "IN_PROGRESS") {
          res.status(409).json({
            error: "The matching request is still in progress",
            code: "IDEMPOTENCY_IN_PROGRESS",
          });
          return;
        }
        if (claim.status === "REPLAY") {
          res.status(claim.responseStatus).json(claim.responseBody);
          return;
        }
        finalizationState.terminal = {
          principalId: principal.principal.principalId,
          operationId: policy.operationId,
          idempotencyKey: key,
          canonicalInputHash,
        };
      } catch (error) {
        const message = databaseErrorCode(error);
        if (message?.includes("idempotency_conflict")) {
          res.status(409).json({
            error: "Idempotency key was reused for different input",
            code: "IDEMPOTENCY_CONFLICT",
          });
          return;
        }
        req.log?.error({ err: error, requestId }, "Idempotency claim failed");
        res.status(503).json({
          error: "Idempotency store is unavailable",
          code: "AUDIT_UNAVAILABLE",
        });
        return;
      }
    }

    req.auth = principal;
    req.operationId = policy.operationId;
    next();
  };
}
