import type { Request } from "express";
import { CSRF_COOKIE, requireCookieCsrf, SESSION_COOKIE } from "./csrf.js";
import {
  identityToPrincipalContext,
  RequestAuthError,
  type AuthRepository,
  type PrincipalContext,
  type ProtectedRoutePolicy,
} from "./types.js";

export function readBearerCredential(req: Request): string | null {
  const authorization = req.get("authorization");
  if (!authorization) return null;
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  return match?.[1] ?? null;
}

export const STEP_UP_HEADER = "x-mie-step-up-authorization";

export async function verifyStepUpCredential(
  req: Request,
  repository: AuthRepository,
  sessionPrincipal: PrincipalContext,
): Promise<string> {
  const authorization = req.get(STEP_UP_HEADER);
  const match = authorization
    ? /^Bearer ([^\s]+)$/.exec(authorization)
    : null;
  if (!match?.[1]) {
    throw new RequestAuthError(
      403,
      "AUTH_FORBIDDEN",
      "Permanent human credential step-up required",
    );
  }
  const identity = await repository.verifyApiCredential(match[1]);
  if (
    !identity ||
    identity.principalKind !== "human" ||
    sessionPrincipal.principal.kind !== "human" ||
    sessionPrincipal.authMode !== "cookie" ||
    identity.principalId !== sessionPrincipal.principal.principalId ||
    identity.credentialId !== sessionPrincipal.credentialId ||
    !identity.scopes.includes("governance:credentials")
  ) {
    throw new RequestAuthError(
      403,
      "AUTH_FORBIDDEN",
      "Permanent human credential step-up failed",
    );
  }
  return identity.credentialId;
}

export async function verifyBearerCredential(
  req: Request,
  repository: AuthRepository,
  requestId: string,
): Promise<PrincipalContext> {
  const rawCredential = readBearerCredential(req);
  if (!rawCredential) {
    throw new RequestAuthError(401, "AUTH_REQUIRED", "Bearer credential required");
  }
  const identity = await repository.verifyApiCredential(rawCredential);
  if (!identity) {
    throw new RequestAuthError(401, "AUTH_REQUIRED", "Credential is invalid");
  }
  return identityToPrincipalContext(identity, requestId, "bearer");
}

async function verifyCookieCredential(
  req: Request,
  repository: AuthRepository,
  requestId: string,
  allowedOrigins: readonly string[],
): Promise<PrincipalContext> {
  const rawSession = req.cookies?.[SESSION_COOKIE];
  if (typeof rawSession !== "string" || rawSession.length < 32) {
    throw new RequestAuthError(401, "AUTH_REQUIRED", "Browser session required");
  }
  const rawCsrf = requireCookieCsrf(req, allowedOrigins);
  const identity = await repository.verifyBrowserSession(rawSession, rawCsrf);
  if (!identity?.sessionId) {
    throw new RequestAuthError(401, "AUTH_REQUIRED", "Browser session is invalid");
  }
  return identityToPrincipalContext(identity, requestId, "cookie");
}

export async function authenticateRequest(
  req: Request,
  policy: ProtectedRoutePolicy,
  repository: AuthRepository,
  requestId: string,
  allowedOrigins: readonly string[],
): Promise<PrincipalContext> {
  const bearer = readBearerCredential(req);
  if (bearer) {
    if (!policy.authModes.includes("bearer")) {
      throw new RequestAuthError(401, "AUTH_REQUIRED", "Browser session required");
    }
    return verifyBearerCredential(req, repository, requestId);
  }

  if (policy.authModes.includes("cookie")) {
    return verifyCookieCredential(
      req,
      repository,
      requestId,
      allowedOrigins,
    );
  }

  // Avoid exposing which alternate auth mode a route supports.
  void req.cookies?.[CSRF_COOKIE];
  throw new RequestAuthError(401, "AUTH_REQUIRED", "Credential required");
}
