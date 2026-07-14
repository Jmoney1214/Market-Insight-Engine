import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import {
  IssueCredentialBody,
  IssuePrincipalBody,
  RevokeCredentialBody,
  RevokeCredentialParams,
  RevokePrincipalBody,
  RevokePrincipalParams,
} from "@workspace/api-zod";
import type {
  CredentialGovernanceSubject,
  PrincipalGovernanceSubject,
  VerifiedControlPlaneContext,
} from "@workspace/db/control-plane";
import {
  CredentialDecisionSchema,
  PrincipalDecisionSchema,
} from "@workspace/research-contracts";
import {
  credentialGovernanceSha256,
  newPermanentCredential,
  principalGovernanceSha256,
} from "../auth/decisionAttestation.js";
import type { AuthRuntime, GovernanceRuntime } from "../auth/types.js";

const router = Router();

function governanceRuntime(
  req: Request,
  res: Response,
): GovernanceRuntime | null {
  const runtime = req.app.locals["authRuntime"] as AuthRuntime;
  if (!runtime.governance) {
    res.status(503).json({
      error: "Governance control plane is unavailable",
      code: "AUDIT_UNAVAILABLE",
    });
    return null;
  }
  return runtime.governance;
}

function governanceContext(
  req: Request,
  res: Response,
): VerifiedControlPlaneContext | null {
  if (!req.auth || !req.stepUpCredentialId) {
    res.status(500).json({
      error: "Verified governance context is missing",
      code: "AUTH_CONTEXT_MISSING",
    });
    return null;
  }
  return {
    requestId: req.auth.requestId,
    principalId: req.auth.principal.principalId,
    credentialId: req.stepUpCredentialId,
  };
}

function decisionActor(req: Request) {
  return {
    humanPrincipalId: req.auth!.principal.principalId,
    credentialId: req.stepUpCredentialId!,
    requestId: req.auth!.requestId,
  } as const;
}

function normalizeScopes(scopes: readonly string[]): readonly string[] | null {
  const trimmed = scopes.map((scope) => scope.trim());
  if (
    trimmed.some((scope) => !scope) ||
    new Set(trimmed).size !== trimmed.length
  ) {
    return null;
  }
  return [...trimmed].sort();
}

function databaseMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

function sendGovernanceFailure(
  req: Request,
  res: Response,
  error: unknown,
): void {
  const message = databaseMessage(error);
  if (message.includes("governance_revision_conflict") || message.includes("duplicate key")) {
    res.status(409).json({
      error: "Governance state changed; refresh and retry with the current revision",
      code: "GOVERNANCE_CONFLICT",
    });
    return;
  }
  if (message.includes("not_found")) {
    res.status(404).json({
      error: "Governance subject was not found",
      code: "GOVERNANCE_SUBJECT_NOT_FOUND",
    });
    return;
  }
  if (
    message.includes("scope_escalation") ||
    message.includes("inactive") ||
    message.includes("owner_required") ||
    message.includes("governance_actor_required")
  ) {
    res.status(403).json({
      error: "Governance action is not authorized for this subject",
      code: "AUTH_FORBIDDEN",
    });
    return;
  }
  if (message.includes("invalid_")) {
    res.status(400).json({
      error: "Governance input is invalid",
      code: "INVALID_GOVERNANCE_INPUT",
    });
    return;
  }
  req.log.error({ err: error }, "Governance persistence failed");
  res.status(503).json({
    error: "Governance persistence is unavailable",
    code: "AUDIT_UNAVAILABLE",
  });
}

router.post("/governance/principals", async (req, res) => {
  const parsed = IssuePrincipalBody.strict().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Principal issuance input is invalid",
      code: "INVALID_GOVERNANCE_INPUT",
    });
    return;
  }
  const scopes = normalizeScopes(parsed.data.scopes);
  const isAgent = parsed.data.principalKind === "agent";
  const hasAgentBinding = Boolean(
    parsed.data.servicePrincipalId &&
      parsed.data.manifestId &&
      parsed.data.manifestVersion,
  );
  const hasAnyAgentField = Boolean(
    parsed.data.servicePrincipalId ||
      parsed.data.manifestId ||
      parsed.data.manifestVersion,
  );
  if (!scopes || (isAgent ? !hasAgentBinding : hasAnyAgentField)) {
    res.status(400).json({
      error: "Principal kind, scopes, and manifest binding are inconsistent",
      code: "INVALID_GOVERNANCE_INPUT",
    });
    return;
  }

  const governance = governanceRuntime(req, res);
  const context = governanceContext(req, res);
  if (!governance || !context) return;
  const principalId = randomUUID();
  const subject: Omit<
    PrincipalGovernanceSubject,
    "headDecisionId" | "headRevision" | "headVerdict"
  > = {
    principalId,
    principalKind: parsed.data.principalKind,
    subject: parsed.data.subject.trim(),
    displayName: parsed.data.displayName.trim(),
    scopes,
    servicePrincipalId: parsed.data.servicePrincipalId ?? null,
    manifestId: parsed.data.manifestId ?? null,
    manifestVersion: parsed.data.manifestVersion ?? null,
  };
  if (!subject.subject || !subject.displayName) {
    res.status(400).json({
      error: "Principal subject and display name are required",
      code: "INVALID_GOVERNANCE_INPUT",
    });
    return;
  }
  const signed = governance.attestor.attestPrincipalDecision({
    ...decisionActor(req),
    verdict: "ACTIVATE",
    rationale: parsed.data.rationale.trim(),
    principalId,
    principalSha256: principalGovernanceSha256(subject),
    revision: 1,
    supersedesDecisionId: null,
  });

  try {
    const decision = await governance.repository.issuePrincipal(context, {
      ...signed,
      principalId,
      principalKind: subject.principalKind,
      subject: subject.subject,
      displayName: subject.displayName,
      scopes,
      ...(subject.servicePrincipalId
        ? { servicePrincipalId: subject.servicePrincipalId }
        : {}),
      ...(subject.manifestId ? { manifestId: subject.manifestId } : {}),
      ...(subject.manifestVersion
        ? { manifestVersion: subject.manifestVersion }
        : {}),
    });
    res.status(201).json({
      principalId,
      decision: PrincipalDecisionSchema.parse(decision),
    });
  } catch (error) {
    sendGovernanceFailure(req, res, error);
  }
});

router.post("/governance/credentials", async (req, res) => {
  const parsed = IssueCredentialBody.strict().safeParse(req.body);
  const scopes = parsed.success ? normalizeScopes(parsed.data.scopes) : null;
  if (!parsed.success || !scopes) {
    res.status(400).json({
      error: "Credential issuance input is invalid",
      code: "INVALID_GOVERNANCE_INPUT",
    });
    return;
  }
  if (parsed.data.expiresAt && parsed.data.expiresAt.getTime() <= Date.now()) {
    res.status(400).json({
      error: "Credential expiry must be in the future",
      code: "INVALID_GOVERNANCE_INPUT",
    });
    return;
  }

  const governance = governanceRuntime(req, res);
  const context = governanceContext(req, res);
  if (!governance || !context) return;
  try {
    const principal = await governance.repository.readPrincipalGovernanceSubject(
      context,
      parsed.data.principalId,
    );
    if (!principal) {
      res.status(404).json({
        error: "Principal was not found",
        code: "GOVERNANCE_SUBJECT_NOT_FOUND",
      });
      return;
    }
    if (principal.headVerdict !== "ACTIVE") {
      res.status(409).json({
        error: "Credential cannot be issued for an inactive principal",
        code: "GOVERNANCE_CONFLICT",
      });
      return;
    }
    const credentialId = randomUUID();
    const { rawSecret, credentialPrefix } = newPermanentCredential();
    const expiresAt = parsed.data.expiresAt?.toISOString() ?? null;
    const subject: Omit<
      CredentialGovernanceSubject,
      "headDecisionId" | "headRevision" | "headVerdict"
    > = {
      credentialId,
      credentialPrefix,
      principalId: principal.principalId,
      scopes,
      expiresAt,
      owningServicePrincipalId: principal.servicePrincipalId,
      manifestId: principal.manifestId,
      manifestVersion: principal.manifestVersion,
      pepperVersion: "v1",
    };
    const signed = governance.attestor.attestCredentialDecision({
      ...decisionActor(req),
      verdict: "ACTIVATE",
      rationale: parsed.data.rationale.trim(),
      credentialId,
      credentialSha256: credentialGovernanceSha256(subject),
      revision: 1,
      supersedesDecisionId: null,
    });
    const decision = await governance.repository.issueCredential(context, {
      ...signed,
      credentialId,
      principalId: principal.principalId,
      rawSecret,
      scopes,
      ...(parsed.data.expiresAt ? { expiresAt: parsed.data.expiresAt } : {}),
    });
    res.locals["idempotencyReplayOverride"] = {
      responseStatus: 409,
      responseBody: {
        error: "Credential was already issued; its plaintext is not recoverable",
        code: "CREDENTIAL_SECRET_NOT_RECOVERABLE",
        credentialId,
        credentialPrefix,
      },
    };
    res.status(201).json({
      credentialId,
      credentialPrefix,
      permanentCredential: rawSecret,
      decision: CredentialDecisionSchema.parse(decision),
    });
  } catch (error) {
    sendGovernanceFailure(req, res, error);
  }
});

router.post("/governance/principals/:principalId/revoke", async (req, res) => {
  const params = RevokePrincipalParams.safeParse(req.params);
  const body = RevokePrincipalBody.strict().safeParse(req.body);
  if (
    !params.success ||
    !body.success ||
    !Number.isInteger(body.data.expectedRevision)
  ) {
    res.status(400).json({
      error: "Principal revocation input is invalid",
      code: "INVALID_GOVERNANCE_INPUT",
    });
    return;
  }
  const governance = governanceRuntime(req, res);
  const context = governanceContext(req, res);
  if (!governance || !context) return;
  try {
    const subject = await governance.repository.readPrincipalGovernanceSubject(
      context,
      params.data.principalId,
    );
    if (!subject) {
      res.status(404).json({
        error: "Principal was not found",
        code: "GOVERNANCE_SUBJECT_NOT_FOUND",
      });
      return;
    }
    if (
      subject.headRevision !== body.data.expectedRevision ||
      subject.headDecisionId !== body.data.expectedDecisionId ||
      subject.headVerdict === "REVOKED"
    ) {
      res.status(409).json({
        error: "Principal decision revision is stale or terminal",
        code: "GOVERNANCE_CONFLICT",
      });
      return;
    }
    const signed = governance.attestor.attestPrincipalDecision({
      ...decisionActor(req),
      verdict: "REVOKE",
      rationale: body.data.rationale.trim(),
      principalId: subject.principalId,
      principalSha256: principalGovernanceSha256(subject),
      revision: subject.headRevision + 1,
      supersedesDecisionId: subject.headDecisionId,
    });
    const decision = await governance.repository.revokePrincipal(context, {
      ...signed,
      subjectId: subject.principalId,
      expectedRevision: subject.headRevision,
      expectedDecisionId: subject.headDecisionId,
    });
    res.json(PrincipalDecisionSchema.parse(decision));
  } catch (error) {
    sendGovernanceFailure(req, res, error);
  }
});

router.post("/governance/credentials/:credentialId/revoke", async (req, res) => {
  const params = RevokeCredentialParams.safeParse(req.params);
  const body = RevokeCredentialBody.strict().safeParse(req.body);
  if (
    !params.success ||
    !body.success ||
    !Number.isInteger(body.data.expectedRevision)
  ) {
    res.status(400).json({
      error: "Credential revocation input is invalid",
      code: "INVALID_GOVERNANCE_INPUT",
    });
    return;
  }
  const governance = governanceRuntime(req, res);
  const context = governanceContext(req, res);
  if (!governance || !context) return;
  try {
    const subject = await governance.repository.readCredentialGovernanceSubject(
      context,
      params.data.credentialId,
    );
    if (!subject) {
      res.status(404).json({
        error: "Credential was not found",
        code: "GOVERNANCE_SUBJECT_NOT_FOUND",
      });
      return;
    }
    if (
      subject.headRevision !== body.data.expectedRevision ||
      subject.headDecisionId !== body.data.expectedDecisionId ||
      subject.headVerdict === "REVOKED"
    ) {
      res.status(409).json({
        error: "Credential decision revision is stale or terminal",
        code: "GOVERNANCE_CONFLICT",
      });
      return;
    }
    const signed = governance.attestor.attestCredentialDecision({
      ...decisionActor(req),
      verdict: "REVOKE",
      rationale: body.data.rationale.trim(),
      credentialId: subject.credentialId,
      credentialSha256: credentialGovernanceSha256(subject),
      revision: subject.headRevision + 1,
      supersedesDecisionId: subject.headDecisionId,
    });
    const decision = await governance.repository.revokeCredential(context, {
      ...signed,
      subjectId: subject.credentialId,
      expectedRevision: subject.headRevision,
      expectedDecisionId: subject.headDecisionId,
    });
    res.json(CredentialDecisionSchema.parse(decision));
  } catch (error) {
    sendGovernanceFailure(req, res, error);
  }
});

export default router;
