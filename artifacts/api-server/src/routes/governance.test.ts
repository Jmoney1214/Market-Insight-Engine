import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type {
  CredentialGovernanceSubject,
  PrincipalGovernanceSubject,
} from "@workspace/db/control-plane";
import type {
  AuthRepository,
  GovernanceRepository,
} from "../auth/types.js";
import { createDecisionAttestor } from "../auth/decisionAttestation.js";
import { unavailableHistoricalCasePort } from "../auth/historicalCasePort.js";
import { createApp } from "../app.js";

const HUMAN_ID = "42000000-0000-4000-8000-000000000001";
const HUMAN_CREDENTIAL_ID = "42000000-0000-4000-8000-000000000002";
const SESSION_ID = "42000000-0000-4000-8000-000000000003";
const SERVICE_ID = "42000000-0000-4000-8000-000000000004";
const SERVICE_DECISION_ID = "42000000-0000-4000-8000-000000000005";
const SERVICE_CREDENTIAL_ID = "42000000-0000-4000-8000-000000000006";
const CREDENTIAL_DECISION_ID = "42000000-0000-4000-8000-000000000007";
const SESSION = `session-${"a".repeat(40)}`;
const CSRF = `csrf-${"b".repeat(40)}`;

const servicePrincipal: PrincipalGovernanceSubject = {
  principalId: SERVICE_ID,
  principalKind: "service",
  subject: "research-service",
  displayName: "Research Service",
  scopes: ["research:read", "research:run"],
  servicePrincipalId: null,
  manifestId: null,
  manifestVersion: null,
  headDecisionId: SERVICE_DECISION_ID,
  headRevision: 1,
  headVerdict: "ACTIVE",
};

const serviceCredential: CredentialGovernanceSubject = {
  credentialId: SERVICE_CREDENTIAL_ID,
  credentialPrefix: "mie_servicecredential1",
  principalId: SERVICE_ID,
  scopes: ["research:read"],
  expiresAt: null,
  owningServicePrincipalId: null,
  manifestId: null,
  manifestVersion: null,
  pepperVersion: "v1",
  headDecisionId: CREDENTIAL_DECISION_ID,
  headRevision: 1,
  headVerdict: "ACTIVE",
};

function fixture(options: {
  stepUpCredentialId?: string;
  principal?: PrincipalGovernanceSubject | null;
  credential?: CredentialGovernanceSubject | null;
} = {}) {
  const completeRequest = vi.fn<AuthRepository["completeRequest"]>(async () => undefined);
  const authRepository: AuthRepository = {
    async verifyApiCredential(secret) {
      if (secret !== "permanent-human-key") return null;
      return {
        principalId: HUMAN_ID,
        credentialId: options.stepUpCredentialId ?? HUMAN_CREDENTIAL_ID,
        principalKind: "human",
        subject: "desk-operator",
        scopes: ["desk:read", "governance:credentials"],
      };
    },
    async verifyBrowserSession(session, csrf) {
      if (session !== SESSION || csrf !== CSRF) return null;
      return {
        principalId: HUMAN_ID,
        credentialId: HUMAN_CREDENTIAL_ID,
        principalKind: "human",
        subject: "desk-operator",
        scopes: ["desk:read", "governance:credentials"],
        sessionId: SESSION_ID,
      };
    },
    async recordRequestStart() {
      return "42000000-0000-4000-8000-000000000008";
    },
    completeRequest,
    async claimIdempotency() {
      return {
        status: "CLAIMED",
        idempotencyRecordId: "42000000-0000-4000-8000-000000000009",
      };
    },
    async createBrowserSession() {
      throw new Error("unused");
    },
    async revokeBrowserSession() {
      throw new Error("unused");
    },
  };

  const rotateBrowserSession = vi.fn<GovernanceRepository["rotateBrowserSession"]>(
    async () => "42000000-0000-4000-8000-000000000010",
  );
  const issuePrincipal = vi.fn<GovernanceRepository["issuePrincipal"]>(
    async (_context, input) => input.decision,
  );
  const issueCredential = vi.fn<GovernanceRepository["issueCredential"]>(
    async (_context, input) => input.decision,
  );
  const readPrincipalGovernanceSubject = vi.fn<
    GovernanceRepository["readPrincipalGovernanceSubject"]
  >(async () => options.principal === undefined ? servicePrincipal : options.principal);
  const readCredentialGovernanceSubject = vi.fn<
    GovernanceRepository["readCredentialGovernanceSubject"]
  >(async () => options.credential === undefined ? serviceCredential : options.credential);
  const revokePrincipal = vi.fn<GovernanceRepository["revokePrincipal"]>(
    async (_context, input) => input.decision,
  );
  const revokeCredential = vi.fn<GovernanceRepository["revokeCredential"]>(
    async (_context, input) => input.decision,
  );
  const governanceRepository: GovernanceRepository = {
    rotateBrowserSession,
    issuePrincipal,
    issueCredential,
    readPrincipalGovernanceSubject,
    readCredentialGovernanceSubject,
    revokePrincipal,
    revokeCredential,
  };
  const app = createApp({
    repository: authRepository,
    allowedOrigins: ["https://desk.test"],
    historicalCasePort: unavailableHistoricalCasePort,
    governance: {
      repository: governanceRepository,
      attestor: createDecisionAttestor({
        keyId: "test-decision-v1",
        key: "test-governance-attestation-key-material-12345",
      }),
    },
  });
  return {
    app,
    completeRequest,
    rotateBrowserSession,
    issuePrincipal,
    issueCredential,
    revokePrincipal,
    revokeCredential,
  };
}

function governanceRequest(app: ReturnType<typeof createApp>, path: string) {
  return request(app)
    .post(path)
    .set("Cookie", `mie_session=${SESSION}; mie_csrf=${CSRF}`)
    .set("Origin", "https://desk.test")
    .set("X-CSRF-Token", CSRF)
    .set("X-MIE-Step-Up-Authorization", "Bearer permanent-human-key")
    .set("Idempotency-Key", crypto.randomUUID());
}

describe("step-up governance routes", () => {
  it("requires the permanent credential in addition to the browser session", async () => {
    const f = fixture();
    const response = await request(f.app)
      .post("/api/governance/principals")
      .set("Cookie", `mie_session=${SESSION}; mie_csrf=${CSRF}`)
      .set("Origin", "https://desk.test")
      .set("X-CSRF-Token", CSRF)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({
        principalKind: "service",
        subject: "research-service-2",
        displayName: "Research Service 2",
        scopes: ["research:read"],
        rationale: "create service",
      });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("AUTH_FORBIDDEN");
    expect(f.rotateBrowserSession).not.toHaveBeenCalled();
    expect(f.issuePrincipal).not.toHaveBeenCalled();
  });

  it("rejects a step-up credential that is not the session credential", async () => {
    const f = fixture({
      stepUpCredentialId: "42000000-0000-4000-8000-000000000099",
    });
    const response = await governanceRequest(
      f.app,
      "/api/governance/principals",
    ).send({
      principalKind: "service",
      subject: "research-service-2",
      displayName: "Research Service 2",
      scopes: ["research:read"],
      rationale: "create service",
    });

    expect(response.status).toBe(403);
    expect(f.issuePrincipal).not.toHaveBeenCalled();
  });

  it("issues a signed service principal and rotates session plus CSRF", async () => {
    const f = fixture();
    const response = await governanceRequest(
      f.app,
      "/api/governance/principals",
    ).send({
      principalKind: "service",
      subject: "research-service-2",
      displayName: "Research Service 2",
      scopes: ["research:run", "research:read"],
      rationale: "create service",
    });

    expect(response.status).toBe(201);
    expect(response.body.decision).toMatchObject({
      decisionType: "PRINCIPAL",
      verdict: "ACTIVATE",
      revision: 1,
      supersedesDecisionId: null,
      humanPrincipalId: HUMAN_ID,
      credentialId: HUMAN_CREDENTIAL_ID,
      attestationKeyId: "test-decision-v1",
    });
    expect(response.body.decision.attestationHmacSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(f.rotateBrowserSession).toHaveBeenCalledOnce();
    expect(f.issuePrincipal.mock.calls[0]?.[1].scopes).toEqual([
      "research:read",
      "research:run",
    ]);
    const cookies = response.headers["set-cookie"] as unknown as string[];
    expect(cookies).toHaveLength(2);
  });

  it("requires exact agent ownership and manifest binding", async () => {
    const f = fixture();
    const response = await governanceRequest(
      f.app,
      "/api/governance/principals",
    ).send({
      principalKind: "agent",
      subject: "catalyst-verifier",
      displayName: "Catalyst Verifier",
      scopes: ["tool:primary-source"],
      rationale: "create new worker agent",
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("INVALID_GOVERNANCE_INPUT");
    expect(f.issuePrincipal).not.toHaveBeenCalled();
  });

  it("returns a permanent credential once without persisting it in idempotency", async () => {
    const f = fixture();
    const response = await governanceRequest(
      f.app,
      "/api/governance/credentials",
    ).send({
      principalId: SERVICE_ID,
      scopes: ["research:read"],
      rationale: "issue service key",
    });

    expect(response.status).toBe(201);
    expect(response.body.permanentCredential).toMatch(/^mie_[^.]+\..{32,}$/);
    expect(response.body.decision).toMatchObject({
      decisionType: "CREDENTIAL",
      verdict: "ACTIVATE",
      revision: 1,
    });
    expect(f.issueCredential.mock.calls[0]?.[1].expiresAt).toBeUndefined();

    const terminal = f.completeRequest.mock.calls[0]?.[2];
    expect(terminal?.responseStatus).toBe(409);
    expect(JSON.stringify(terminal?.responseBody)).not.toContain(
      response.body.permanentCredential,
    );
    expect(terminal?.responseBody).toMatchObject({
      code: "CREDENTIAL_SECRET_NOT_RECOVERABLE",
    });
  });

  it("appends a signed revocation only against the exact chain head", async () => {
    const f = fixture();
    const response = await governanceRequest(
      f.app,
      `/api/governance/credentials/${SERVICE_CREDENTIAL_ID}/revoke`,
    ).send({
      expectedRevision: 1,
      expectedDecisionId: CREDENTIAL_DECISION_ID,
      rationale: "credential retired",
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      decisionType: "CREDENTIAL",
      verdict: "REVOKE",
      revision: 2,
      supersedesDecisionId: CREDENTIAL_DECISION_ID,
    });
    expect(f.revokeCredential).toHaveBeenCalledOnce();
  });

  it("rejects a stale revocation before writing a decision", async () => {
    const f = fixture();
    const response = await governanceRequest(
      f.app,
      `/api/governance/principals/${SERVICE_ID}/revoke`,
    ).send({
      expectedRevision: 2,
      expectedDecisionId: SERVICE_DECISION_ID,
      rationale: "stale request",
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("GOVERNANCE_CONFLICT");
    expect(f.revokePrincipal).not.toHaveBeenCalled();
  });
});
