import { randomBytes, randomUUID } from "node:crypto";
import type {
  CredentialGovernanceSubject,
  PrincipalGovernanceSubject,
  SignedDecisionInput,
} from "@workspace/db/control-plane";
import {
  CredentialDecisionSchema,
  PrincipalDecisionSchema,
  hmacCanonical,
  sha256Canonical,
} from "@workspace/research-contracts";

export type DecisionActor = Readonly<{
  humanPrincipalId: string;
  credentialId: string;
  requestId: string;
}>;

export type PrincipalDecisionAttestationInput = DecisionActor &
  Readonly<{
    verdict: "ACTIVATE" | "REVOKE";
    rationale: string;
    principalId: string;
    principalSha256: string;
    revision: number;
    supersedesDecisionId: string | null;
  }>;

export type CredentialDecisionAttestationInput = DecisionActor &
  Readonly<{
    verdict: "ACTIVATE" | "REVOKE";
    rationale: string;
    credentialId: string;
    credentialSha256: string;
    revision: number;
    supersedesDecisionId: string | null;
  }>;

export interface DecisionAttestor {
  attestPrincipalDecision(
    input: PrincipalDecisionAttestationInput,
  ): SignedDecisionInput;
  attestCredentialDecision(
    input: CredentialDecisionAttestationInput,
  ): SignedDecisionInput;
}

function normalizedScopes(scopes: readonly string[]): readonly string[] {
  return [...new Set(scopes)].sort();
}

export function principalGovernanceSha256(
  subject: Omit<
    PrincipalGovernanceSubject,
    "headDecisionId" | "headRevision" | "headVerdict"
  >,
): string {
  return sha256Canonical({
    principalId: subject.principalId,
    principalKind: subject.principalKind,
    subject: subject.subject,
    displayName: subject.displayName,
    scopes: normalizedScopes(subject.scopes),
    servicePrincipalId: subject.servicePrincipalId,
    manifestId: subject.manifestId,
    manifestVersion: subject.manifestVersion,
  });
}

export function credentialGovernanceSha256(
  subject: Omit<
    CredentialGovernanceSubject,
    "headDecisionId" | "headRevision" | "headVerdict"
  >,
): string {
  return sha256Canonical({
    credentialId: subject.credentialId,
    credentialPrefix: subject.credentialPrefix,
    principalId: subject.principalId,
    scopes: normalizedScopes(subject.scopes),
    expiresAt: subject.expiresAt,
    owningServicePrincipalId: subject.owningServicePrincipalId,
    manifestId: subject.manifestId,
    manifestVersion: subject.manifestVersion,
    pepperVersion: subject.pepperVersion,
  });
}

export function newPermanentCredential(): {
  rawSecret: string;
  credentialPrefix: string;
} {
  const credentialPrefix = `mie_${randomBytes(18).toString("base64url")}`;
  return {
    credentialPrefix,
    rawSecret: `${credentialPrefix}.${randomBytes(32).toString("base64url")}`,
  };
}

export function createDecisionAttestor(config: {
  keyId: string;
  key: string;
}): DecisionAttestor {
  const keyId = config.keyId.trim();
  if (!keyId || Buffer.byteLength(config.key, "utf8") < 32) {
    throw new Error(
      "Decision attestation requires a key ID and at least 32 bytes of key material",
    );
  }

  function signedDecision(
    unsigned: Readonly<Record<string, unknown>>,
    schema: typeof PrincipalDecisionSchema | typeof CredentialDecisionSchema,
  ): SignedDecisionInput {
    const decision = schema.parse({
      ...unsigned,
      attestationHmacSha256: hmacCanonical(unsigned, config.key),
    });
    return {
      decision,
      canonicalPayloadSha256: sha256Canonical(decision),
    };
  }

  function common(input: DecisionActor & {
    verdict: string;
    rationale: string;
    revision: number;
    supersedesDecisionId: string | null;
  }): Readonly<Record<string, unknown>> {
    return {
      decisionId: randomUUID(),
      verdict: input.verdict,
      rationale: input.rationale,
      revision: input.revision,
      supersedesDecisionId: input.supersedesDecisionId,
      humanPrincipalId: input.humanPrincipalId,
      credentialId: input.credentialId,
      requestId: input.requestId,
      decidedAt: new Date().toISOString(),
      nonce: randomBytes(32).toString("base64url"),
      attestationKeyId: keyId,
    };
  }

  return {
    attestPrincipalDecision(input) {
      return signedDecision(
        {
          ...common(input),
          decisionType: "PRINCIPAL",
          subject: {
            subjectType: "PRINCIPAL",
            principalId: input.principalId,
            principalSha256: input.principalSha256,
          },
        },
        PrincipalDecisionSchema,
      );
    },
    attestCredentialDecision(input) {
      return signedDecision(
        {
          ...common(input),
          decisionType: "CREDENTIAL",
          subject: {
            subjectType: "CREDENTIAL",
            credentialId: input.credentialId,
            credentialSha256: input.credentialSha256,
          },
        },
        CredentialDecisionSchema,
      );
    },
  };
}
