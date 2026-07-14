import type pg from "pg";
import {
  withControlPlaneTransaction,
  withControlPlaneSecretsTransaction,
  type VerifiedControlPlaneContext,
} from "./context.js";
import type { ControlPlanePools } from "./pools.js";

export type DbPrincipalKind = "human" | "service" | "agent";

export type DbVerifiedIdentity = Readonly<{
  principalId: string;
  credentialId: string;
  principalKind: DbPrincipalKind;
  subject: string;
  scopes: readonly string[];
  servicePrincipalId?: string;
  manifestId?: string;
  manifestVersion?: string;
  sessionId?: string;
}>;

export type RequestAuditStart = Readonly<{
  requestId: string;
  method: string;
  route: string;
  authOutcome: "AUTHENTICATED" | "UNAUTHENTICATED" | "REJECTED";
  identity?: DbVerifiedIdentity;
  runId?: string;
}>;

export type RequestCompletion = Readonly<{
  requestId: string;
  responseStatus: number;
  latencyMs: number;
  errorCode?: string;
  errorMessage?: string;
  runId?: string;
}>;

export type IdempotencyClaim =
  | Readonly<{ status: "CLAIMED"; idempotencyRecordId: string }>
  | Readonly<{ status: "IN_PROGRESS"; idempotencyRecordId: string }>
  | Readonly<{
      status: "REPLAY";
      idempotencyRecordId: string;
      completionRecordId: string;
      responseStatus: number;
      responseBody: unknown;
    }>;

export type IdempotencyTerminal = Readonly<{
  principalId: string;
  operationId: string;
  idempotencyKey: string;
  canonicalInputHash: string;
  responseStatus: number;
  responseBody: unknown;
}>;

export type BrowserSessionCreation = Readonly<{
  principalId: string;
  credentialId: string;
  rawSessionToken: string;
  rawCsrfToken: string;
  requestId: string;
  expiresAt?: Date;
}>;

export type PrincipalGovernanceSubject = Readonly<{
  principalId: string;
  principalKind: DbPrincipalKind;
  subject: string;
  displayName: string;
  scopes: readonly string[];
  servicePrincipalId: string | null;
  manifestId: string | null;
  manifestVersion: string | null;
  headDecisionId: string;
  headRevision: number;
  headVerdict: "ACTIVE" | "SUSPENDED" | "REVOKED";
}>;

export type CredentialGovernanceSubject = Readonly<{
  credentialId: string;
  credentialPrefix: string;
  principalId: string;
  scopes: readonly string[];
  expiresAt: string | null;
  owningServicePrincipalId: string | null;
  manifestId: string | null;
  manifestVersion: string | null;
  pepperVersion: string;
  headDecisionId: string;
  headRevision: number;
  headVerdict: "ACTIVE" | "REVOKED";
}>;

export type SignedDecisionInput = Readonly<{
  decision: Readonly<Record<string, unknown>>;
  canonicalPayloadSha256: string;
}>;

export type SignedPrincipalIssuance = SignedDecisionInput &
  Readonly<{
    principalId: string;
    principalKind: DbPrincipalKind;
    subject: string;
    displayName: string;
    scopes: readonly string[];
    servicePrincipalId?: string;
    manifestId?: string;
    manifestVersion?: string;
  }>;

export type SignedCredentialIssuance = SignedDecisionInput &
  Readonly<{
    credentialId: string;
    principalId: string;
    rawSecret: string;
    scopes: readonly string[];
    expiresAt?: Date;
  }>;

export type SignedRevocation = SignedDecisionInput &
  Readonly<{
    subjectId: string;
    expectedRevision: number;
    expectedDecisionId: string;
  }>;

function objectPayload(row: unknown): Record<string, unknown> {
  if (!row || typeof row !== "object") {
    throw new Error("Control-plane function returned an invalid payload");
  }
  return row as Record<string, unknown>;
}

function stringField(
  payload: Record<string, unknown>,
  key: string,
): string {
  const value = payload[key];
  if (typeof value !== "string" || !value) {
    throw new Error(`Control-plane payload is missing ${key}`);
  }
  return value;
}

function nullableStringField(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new Error(`Control-plane payload has invalid ${key}`);
  }
  return value;
}

function positiveIntegerField(
  payload: Record<string, unknown>,
  key: string,
): number {
  const value = payload[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`Control-plane payload has invalid ${key}`);
  }
  return value;
}

function stringArrayField(
  payload: Record<string, unknown>,
  key: string,
): readonly string[] {
  const value = payload[key];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`Control-plane payload has invalid ${key}`);
  }
  return value;
}

function identityFromPayload(payloadValue: unknown): DbVerifiedIdentity | null {
  const payload = objectPayload(payloadValue);
  if (payload["authenticated"] !== true) return null;
  const kind = payload["principal_kind"];
  if (kind !== "human" && kind !== "service" && kind !== "agent") {
    throw new Error("Control-plane payload has an invalid principal kind");
  }
  const scopes = payload["scopes"];
  if (!Array.isArray(scopes) || !scopes.every((scope) => typeof scope === "string")) {
    throw new Error("Control-plane payload has invalid scopes");
  }
  return {
    principalId: stringField(payload, "principal_id"),
    credentialId: stringField(payload, "credential_id"),
    principalKind: kind,
    subject: stringField(payload, "subject"),
    scopes,
    ...(typeof payload["service_principal_id"] === "string"
      ? { servicePrincipalId: payload["service_principal_id"] }
      : {}),
    ...(typeof payload["manifest_id"] === "string"
      ? { manifestId: payload["manifest_id"] }
      : {}),
    ...(typeof payload["manifest_version"] === "string"
      ? { manifestVersion: payload["manifest_version"] }
      : {}),
    ...(typeof payload["session_id"] === "string"
      ? { sessionId: payload["session_id"] }
      : {}),
  };
}

async function scalarPayload(
  client: Pick<pg.Pool, "query"> | pg.PoolClient,
  sql: string,
  values: readonly unknown[],
): Promise<Record<string, unknown>> {
  const result = await client.query<{ payload: unknown }>(sql, [...values]);
  return objectPayload(result.rows[0]?.payload);
}

async function nullableScalarPayload(
  client: Pick<pg.Pool, "query"> | pg.PoolClient,
  sql: string,
  values: readonly unknown[],
): Promise<Record<string, unknown> | null> {
  const result = await client.query<{ payload: unknown }>(sql, [...values]);
  const payload = result.rows[0]?.payload;
  return payload === null || payload === undefined ? null : objectPayload(payload);
}

function requiredGovernanceContext(
  context: VerifiedControlPlaneContext,
): asserts context is VerifiedControlPlaneContext & {
  principalId: string;
  credentialId: string;
} {
  if (!context.principalId || !context.credentialId) {
    throw new Error("Governance requires verified principal and step-up credential context");
  }
}

function principalSubjectFromPayload(
  payload: Record<string, unknown>,
): PrincipalGovernanceSubject {
  const kind = payload["principal_kind"];
  const verdict = payload["head_verdict"];
  if (kind !== "human" && kind !== "service" && kind !== "agent") {
    throw new Error("Governance payload has invalid principal kind");
  }
  if (verdict !== "ACTIVE" && verdict !== "SUSPENDED" && verdict !== "REVOKED") {
    throw new Error("Governance payload has invalid principal verdict");
  }
  return {
    principalId: stringField(payload, "principal_id"),
    principalKind: kind,
    subject: stringField(payload, "subject"),
    displayName: stringField(payload, "display_name"),
    scopes: stringArrayField(payload, "scopes"),
    servicePrincipalId: nullableStringField(payload, "service_principal_id"),
    manifestId: nullableStringField(payload, "manifest_id"),
    manifestVersion: nullableStringField(payload, "manifest_version"),
    headDecisionId: stringField(payload, "head_decision_id"),
    headRevision: positiveIntegerField(payload, "head_revision"),
    headVerdict: verdict,
  };
}

function credentialSubjectFromPayload(
  payload: Record<string, unknown>,
): CredentialGovernanceSubject {
  const verdict = payload["head_verdict"];
  if (verdict !== "ACTIVE" && verdict !== "REVOKED") {
    throw new Error("Governance payload has invalid credential verdict");
  }
  const expiresAtValue = nullableStringField(payload, "expires_at");
  const expiresAt = expiresAtValue
    ? new Date(expiresAtValue).toISOString()
    : null;
  return {
    credentialId: stringField(payload, "credential_id"),
    credentialPrefix: stringField(payload, "credential_prefix"),
    principalId: stringField(payload, "principal_id"),
    scopes: stringArrayField(payload, "scopes"),
    expiresAt,
    owningServicePrincipalId: nullableStringField(
      payload,
      "owning_service_principal_id",
    ),
    manifestId: nullableStringField(payload, "manifest_id"),
    manifestVersion: nullableStringField(payload, "manifest_version"),
    pepperVersion: stringField(payload, "pepper_version"),
    headDecisionId: stringField(payload, "head_decision_id"),
    headRevision: positiveIntegerField(payload, "head_revision"),
    headVerdict: verdict,
  };
}

export class ControlPlaneAuthRepository {
  constructor(private readonly pools: ControlPlanePools) {}

  async verifyApiCredential(rawSecret: string): Promise<DbVerifiedIdentity | null> {
    const payload = await withControlPlaneSecretsTransaction(
      this.pools,
      "api",
      (client) =>
        scalarPayload(
          client,
          "select governance.verify_api_credential($1) as payload",
          [rawSecret],
        ),
    );
    return identityFromPayload(payload);
  }

  async verifyBrowserSession(
    rawSessionToken: string,
    rawCsrfToken: string,
  ): Promise<DbVerifiedIdentity | null> {
    const payload = await withControlPlaneSecretsTransaction(
      this.pools,
      "api",
      (client) =>
        scalarPayload(
          client,
          "select governance.verify_browser_session($1, $2) as payload",
          [rawSessionToken, rawCsrfToken],
        ),
    );
    return identityFromPayload(payload);
  }

  async recordRequestStart(start: RequestAuditStart): Promise<string> {
    const context: VerifiedControlPlaneContext = {
      requestId: start.requestId,
      ...(start.identity
        ? {
            principalId: start.identity.principalId,
            credentialId: start.identity.credentialId,
          }
        : {}),
      ...(start.runId ? { runId: start.runId } : {}),
    };
    return withControlPlaneTransaction(this.pools, "api", context, async (client) => {
      const payload = await scalarPayload(
        client,
        `select operations.record_api_request_start(
           $1, $2, $3, $4, $5::uuid, $6::uuid, $7, $8::text[], $9::uuid
         ) as payload`,
        [
          start.requestId,
          start.method,
          start.route,
          start.authOutcome,
          start.identity?.credentialId ?? null,
          start.identity?.principalId ?? null,
          start.identity?.principalKind ?? null,
          start.identity ? [...start.identity.scopes] : null,
          start.runId ?? null,
        ],
      );
      return stringField(payload, "audit_id");
    });
  }

  async completeRequest(
    context: VerifiedControlPlaneContext,
    completion: RequestCompletion,
    terminal?: IdempotencyTerminal,
  ): Promise<void> {
    await withControlPlaneTransaction(this.pools, "api", context, async (client) => {
      if (terminal) {
        await scalarPayload(
          client,
          `select operations.terminalize_idempotency(
             $1::uuid, $2, $3, $4, $5, $6::jsonb
           ) as payload`,
          [
            terminal.principalId,
            terminal.operationId,
            terminal.idempotencyKey,
            terminal.canonicalInputHash,
            terminal.responseStatus,
            JSON.stringify(terminal.responseBody),
          ],
        );
      }
      await scalarPayload(
        client,
        `select operations.record_api_request_completion(
           $1, $2, $3, $4, $5, $6::uuid
         ) as payload`,
        [
          completion.requestId,
          completion.responseStatus,
          completion.latencyMs,
          completion.errorCode ?? null,
          completion.errorMessage ?? null,
          completion.runId ?? null,
        ],
      );
    });
  }

  async claimIdempotency(
    context: VerifiedControlPlaneContext,
    operationId: string,
    idempotencyKey: string,
    canonicalInputHash: string,
  ): Promise<IdempotencyClaim> {
    if (!context.principalId) throw new Error("Idempotency requires a principal");
    return withControlPlaneTransaction(this.pools, "api", context, async (client) => {
      const payload = await scalarPayload(
        client,
        "select operations.claim_idempotency($1::uuid, $2, $3, $4) as payload",
        [context.principalId, operationId, idempotencyKey, canonicalInputHash],
      );
      const status = stringField(payload, "status");
      const idempotencyRecordId = stringField(payload, "idempotency_record_id");
      if (status === "CLAIMED" || status === "IN_PROGRESS") {
        return { status, idempotencyRecordId };
      }
      if (status === "REPLAY") {
        const responseStatus = payload["response_status"];
        if (typeof responseStatus !== "number") {
          throw new Error("Replay payload has an invalid response status");
        }
        return {
          status,
          idempotencyRecordId,
          completionRecordId: stringField(payload, "completion_record_id"),
          responseStatus,
          responseBody: payload["response_body"],
        };
      }
      throw new Error(`Unexpected idempotency status: ${status}`);
    });
  }

  async createBrowserSession(input: BrowserSessionCreation): Promise<string> {
    const context: VerifiedControlPlaneContext = {
      requestId: input.requestId,
      principalId: input.principalId,
      credentialId: input.credentialId,
    };
    return withControlPlaneTransaction(this.pools, "api", context, async (client) => {
      const payload = await scalarPayload(
        client,
        `select governance.create_browser_session(
           $1::uuid, $2::uuid, $3, $4, $5, $6::timestamptz
         ) as payload`,
        [
          input.principalId,
          input.credentialId,
          input.rawSessionToken,
          input.rawCsrfToken,
          input.requestId,
          input.expiresAt?.toISOString() ?? null,
        ],
      );
      return stringField(payload, "session_id");
    });
  }

  async revokeBrowserSession(
    context: VerifiedControlPlaneContext,
    sessionId: string,
    rationale: string,
  ): Promise<void> {
    if (!context.principalId) throw new Error("Session revocation requires a principal");
    await withControlPlaneTransaction(this.pools, "api", context, async (client) => {
      await scalarPayload(
        client,
        `select governance.revoke_browser_session(
           $1::uuid, 1, $2::uuid, $3, $4
         ) as payload`,
        [sessionId, context.principalId, context.requestId, rationale],
      );
    });
  }

  async rotateBrowserSession(
    context: VerifiedControlPlaneContext,
    sessionId: string,
    rawSessionToken: string,
    rawCsrfToken: string,
  ): Promise<string> {
    requiredGovernanceContext(context);
    return withControlPlaneTransaction(this.pools, "api", context, async (client) => {
      const payload = await scalarPayload(
        client,
        `select governance.rotate_browser_session(
           $1::uuid, $2::uuid, $3::uuid, $4, $5, $6
         ) as payload`,
        [
          sessionId,
          context.principalId,
          context.credentialId,
          rawSessionToken,
          rawCsrfToken,
          context.requestId,
        ],
      );
      return stringField(payload, "session_id");
    });
  }

  async issuePrincipal(
    context: VerifiedControlPlaneContext,
    input: SignedPrincipalIssuance,
  ): Promise<Readonly<Record<string, unknown>>> {
    requiredGovernanceContext(context);
    return withControlPlaneTransaction(this.pools, "api", context, async (client) =>
      scalarPayload(
        client,
        `select governance.issue_principal_signed(
           $1::uuid, $2, $3, $4, $5::text[], $6::uuid, $7, $8,
           $9::uuid, $10::uuid, $11, $12::jsonb, $13
         ) as payload`,
        [
          input.principalId,
          input.principalKind,
          input.subject,
          input.displayName,
          [...input.scopes],
          input.servicePrincipalId ?? null,
          input.manifestId ?? null,
          input.manifestVersion ?? null,
          context.principalId,
          context.credentialId,
          context.requestId,
          JSON.stringify(input.decision),
          input.canonicalPayloadSha256,
        ],
      ),
    );
  }

  async issueCredential(
    context: VerifiedControlPlaneContext,
    input: SignedCredentialIssuance,
  ): Promise<Readonly<Record<string, unknown>>> {
    requiredGovernanceContext(context);
    return withControlPlaneTransaction(this.pools, "api", context, async (client) =>
      scalarPayload(
        client,
        `select governance.issue_api_credential_signed(
           $1::uuid, $2::uuid, $3, $4::text[], $5::timestamptz,
           $6::uuid, $7::uuid, $8, $9::jsonb, $10
         ) as payload`,
        [
          input.credentialId,
          input.principalId,
          input.rawSecret,
          [...input.scopes],
          input.expiresAt?.toISOString() ?? null,
          context.principalId,
          context.credentialId,
          context.requestId,
          JSON.stringify(input.decision),
          input.canonicalPayloadSha256,
        ],
      ),
    );
  }

  async readPrincipalGovernanceSubject(
    context: VerifiedControlPlaneContext,
    principalId: string,
  ): Promise<PrincipalGovernanceSubject | null> {
    requiredGovernanceContext(context);
    return withControlPlaneTransaction(this.pools, "api", context, async (client) => {
      const payload = await nullableScalarPayload(
        client,
        `select governance.read_principal_governance_subject(
           $1::uuid, $2::uuid, $3::uuid, $4
         ) as payload`,
        [principalId, context.principalId, context.credentialId, context.requestId],
      );
      return payload ? principalSubjectFromPayload(payload) : null;
    });
  }

  async readCredentialGovernanceSubject(
    context: VerifiedControlPlaneContext,
    credentialId: string,
  ): Promise<CredentialGovernanceSubject | null> {
    requiredGovernanceContext(context);
    return withControlPlaneTransaction(this.pools, "api", context, async (client) => {
      const payload = await nullableScalarPayload(
        client,
        `select governance.read_credential_governance_subject(
           $1::uuid, $2::uuid, $3::uuid, $4
         ) as payload`,
        [credentialId, context.principalId, context.credentialId, context.requestId],
      );
      return payload ? credentialSubjectFromPayload(payload) : null;
    });
  }

  async revokePrincipal(
    context: VerifiedControlPlaneContext,
    input: SignedRevocation,
  ): Promise<Readonly<Record<string, unknown>>> {
    requiredGovernanceContext(context);
    return withControlPlaneTransaction(this.pools, "api", context, async (client) =>
      scalarPayload(
        client,
        `select governance.append_principal_revocation_signed(
           $1::uuid, $2, $3::uuid, $4::uuid, $5::uuid, $6, $7::jsonb, $8
         ) as payload`,
        [
          input.subjectId,
          input.expectedRevision,
          input.expectedDecisionId,
          context.principalId,
          context.credentialId,
          context.requestId,
          JSON.stringify(input.decision),
          input.canonicalPayloadSha256,
        ],
      ),
    );
  }

  async revokeCredential(
    context: VerifiedControlPlaneContext,
    input: SignedRevocation,
  ): Promise<Readonly<Record<string, unknown>>> {
    requiredGovernanceContext(context);
    return withControlPlaneTransaction(this.pools, "api", context, async (client) =>
      scalarPayload(
        client,
        `select governance.append_credential_revocation_signed(
           $1::uuid, $2, $3::uuid, $4::uuid, $5::uuid, $6, $7::jsonb, $8
         ) as payload`,
        [
          input.subjectId,
          input.expectedRevision,
          input.expectedDecisionId,
          context.principalId,
          context.credentialId,
          context.requestId,
          JSON.stringify(input.decision),
          input.canonicalPayloadSha256,
        ],
      ),
    );
  }
}
