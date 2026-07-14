import type { Request } from "express";
import type {
  BrowserSessionCreation,
  CredentialGovernanceSubject,
  DbVerifiedIdentity,
  IdempotencyClaim,
  IdempotencyTerminal,
  PrincipalGovernanceSubject,
  RequestAuditStart,
  RequestCompletion,
  SignedCredentialIssuance,
  SignedPrincipalIssuance,
  SignedRevocation,
  VerifiedControlPlaneContext,
} from "@workspace/db/control-plane";
import type { HistoricalCasePort } from "./historicalCasePort.js";
import type { DecisionAttestor } from "./decisionAttestation.js";

export type PrincipalKind = "human" | "service" | "agent";
export type AuthMode = "bearer" | "cookie";

export type Principal = Readonly<{
  principalId: string;
  kind: PrincipalKind;
  subject: string;
  servicePrincipalId?: string;
  manifestId?: string;
  manifestVersion?: string;
}>;

export type PrincipalContext = Readonly<{
  requestId: string;
  credentialId: string;
  principal: Principal;
  effectiveScopes: readonly string[];
  authMode: AuthMode;
  sessionId?: string;
}>;

export interface AuthRepository {
  verifyApiCredential(rawSecret: string): Promise<DbVerifiedIdentity | null>;
  verifyBrowserSession(
    rawSessionToken: string,
    rawCsrfToken: string,
  ): Promise<DbVerifiedIdentity | null>;
  recordRequestStart(start: RequestAuditStart): Promise<string>;
  completeRequest(
    context: VerifiedControlPlaneContext,
    completion: RequestCompletion,
    terminal?: IdempotencyTerminal,
  ): Promise<void>;
  claimIdempotency(
    context: VerifiedControlPlaneContext,
    operationId: string,
    idempotencyKey: string,
    canonicalInputHash: string,
  ): Promise<IdempotencyClaim>;
  createBrowserSession(input: BrowserSessionCreation): Promise<string>;
  revokeBrowserSession(
    context: VerifiedControlPlaneContext,
    sessionId: string,
    rationale: string,
  ): Promise<void>;
}

export interface GovernanceRepository {
  rotateBrowserSession(
    context: VerifiedControlPlaneContext,
    sessionId: string,
    rawSessionToken: string,
    rawCsrfToken: string,
  ): Promise<string>;
  issuePrincipal(
    context: VerifiedControlPlaneContext,
    input: SignedPrincipalIssuance,
  ): Promise<Readonly<Record<string, unknown>>>;
  issueCredential(
    context: VerifiedControlPlaneContext,
    input: SignedCredentialIssuance,
  ): Promise<Readonly<Record<string, unknown>>>;
  readPrincipalGovernanceSubject(
    context: VerifiedControlPlaneContext,
    principalId: string,
  ): Promise<PrincipalGovernanceSubject | null>;
  readCredentialGovernanceSubject(
    context: VerifiedControlPlaneContext,
    credentialId: string,
  ): Promise<CredentialGovernanceSubject | null>;
  revokePrincipal(
    context: VerifiedControlPlaneContext,
    input: SignedRevocation,
  ): Promise<Readonly<Record<string, unknown>>>;
  revokeCredential(
    context: VerifiedControlPlaneContext,
    input: SignedRevocation,
  ): Promise<Readonly<Record<string, unknown>>>;
}

export type GovernanceRuntime = Readonly<{
  repository: GovernanceRepository;
  attestor: DecisionAttestor;
}>;

export type PublicRoutePolicy = Readonly<{
  operationId: string;
  method: string;
  path: string;
  auth: "public";
  idempotency: "none";
}>;

export type ProtectedRoutePolicy = Readonly<{
  operationId: string;
  method: string;
  path: string;
  auth: "protected";
  authModes: readonly AuthMode[];
  allowedKinds: readonly PrincipalKind[];
  requiredScopes: readonly string[];
  idempotency: "none" | "required";
  stepUp?: boolean;
}>;

export type RoutePolicy = PublicRoutePolicy | ProtectedRoutePolicy;

export type AuthRuntime = Readonly<{
  repository: AuthRepository;
  allowedOrigins: readonly string[];
  historicalCasePort: HistoricalCasePort;
  governance?: GovernanceRuntime;
}>;

export class RequestAuthError extends Error {
  constructor(
    readonly status: 401 | 403,
    readonly code: "AUTH_REQUIRED" | "AUTH_FORBIDDEN",
    message: string,
  ) {
    super(message);
    this.name = "RequestAuthError";
  }
}

export function identityToPrincipalContext(
  identity: DbVerifiedIdentity,
  requestId: string,
  authMode: AuthMode,
): PrincipalContext {
  return {
    requestId,
    credentialId: identity.credentialId,
    principal: {
      principalId: identity.principalId,
      kind: identity.principalKind,
      subject: identity.subject,
      ...(identity.servicePrincipalId
        ? { servicePrincipalId: identity.servicePrincipalId }
        : {}),
      ...(identity.manifestId ? { manifestId: identity.manifestId } : {}),
      ...(identity.manifestVersion
        ? { manifestVersion: identity.manifestVersion }
        : {}),
    },
    effectiveScopes: [...identity.scopes],
    authMode,
    ...(identity.sessionId ? { sessionId: identity.sessionId } : {}),
  };
}

export type AuthenticatedRequest = Request & {
  auth: PrincipalContext;
  operationId: string;
  stepUpCredentialId?: string;
};
