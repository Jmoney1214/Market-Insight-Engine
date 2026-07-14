import { describe, expect, it } from "vitest";
import { hmacCanonical } from "@workspace/research-contracts";
import {
  createDecisionAttestor,
  newPermanentCredential,
  principalGovernanceSha256,
} from "./decisionAttestation.js";

const KEY = "test-decision-attestation-key-material-123456";

describe("decision attestation", () => {
  it("signs the exact canonical principal decision payload", () => {
    const attestor = createDecisionAttestor({ keyId: "test-v1", key: KEY });
    const signed = attestor.attestPrincipalDecision({
      verdict: "ACTIVATE",
      rationale: "create service",
      principalId: "41000000-0000-4000-8000-000000000001",
      principalSha256: "a".repeat(64),
      revision: 1,
      supersedesDecisionId: null,
      humanPrincipalId: "41000000-0000-4000-8000-000000000002",
      credentialId: "41000000-0000-4000-8000-000000000003",
      requestId: "request-1",
    });
    const { attestationHmacSha256, ...unsigned } = signed.decision as Record<
      string,
      unknown
    >;

    expect(attestationHmacSha256).toBe(hmacCanonical(unsigned, KEY));
    expect(signed.canonicalPayloadSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes normalized immutable principal fields", () => {
    const left = principalGovernanceSha256({
      principalId: "41000000-0000-4000-8000-000000000001",
      principalKind: "service",
      subject: "research-service",
      displayName: "Research Service",
      scopes: ["research:run", "research:read"],
      servicePrincipalId: null,
      manifestId: null,
      manifestVersion: null,
    });
    const reordered = principalGovernanceSha256({
      principalId: "41000000-0000-4000-8000-000000000001",
      principalKind: "service",
      subject: "research-service",
      displayName: "Research Service",
      scopes: ["research:read", "research:run"],
      servicePrincipalId: null,
      manifestId: null,
      manifestVersion: null,
    });
    expect(reordered).toBe(left);
  });

  it("creates a high-entropy permanent credential without an expiry", () => {
    const credential = newPermanentCredential();
    expect(credential.rawSecret).toMatch(
      /^mie_[A-Za-z0-9_-]{12,64}\.[A-Za-z0-9_-]{32,}$/,
    );
    expect(credential.rawSecret.startsWith(`${credential.credentialPrefix}.`)).toBe(
      true,
    );
  });

  it("rejects missing or short attestation keys", () => {
    expect(() => createDecisionAttestor({ keyId: "", key: KEY })).toThrow();
    expect(() => createDecisionAttestor({ keyId: "test-v1", key: "short" })).toThrow();
  });
});
