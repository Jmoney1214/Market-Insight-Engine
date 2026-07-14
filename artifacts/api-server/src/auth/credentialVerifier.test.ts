import { describe, expect, it, vi } from "vitest";
import {
  authenticateRequest,
  readBearerCredential,
  verifyBearerCredential,
} from "./credentialVerifier.js";
import type { AuthRepository, ProtectedRoutePolicy } from "./types.js";

function request(headers: Record<string, string> = {}, cookies: Record<string, string> = {}) {
  return {
    method: "GET",
    cookies,
    get(name: string) {
      return headers[name.toLowerCase()];
    },
  } as never;
}

function repository(): AuthRepository {
  return {
    async verifyApiCredential(secret) {
      if (secret !== "valid-secret") return null;
      return {
        principalId: "11000000-0000-4000-8000-000000000001",
        credentialId: "11000000-0000-4000-8000-000000000002",
        principalKind: "agent",
        subject: "catalyst-verifier",
        scopes: ["tool:fmp", "tool:primary-source"],
        servicePrincipalId: "11000000-0000-4000-8000-000000000003",
        manifestId: "catalyst-verifier",
        manifestVersion: "v1",
      };
    },
    async verifyBrowserSession() {
      return null;
    },
    async recordRequestStart() {
      return "unused";
    },
    async completeRequest() {},
    async claimIdempotency() {
      throw new Error("unused");
    },
    async createBrowserSession() {
      throw new Error("unused");
    },
    async revokeBrowserSession() {
      throw new Error("unused");
    },
  };
}

const anyProtectedPolicy: ProtectedRoutePolicy = {
  operationId: "testOperation",
  method: "GET",
  path: "/test",
  auth: "protected",
  authModes: ["bearer", "cookie"],
  allowedKinds: ["human", "service", "agent"],
  requiredScopes: [],
  idempotency: "none",
};

describe("credential verification", () => {
  it("accepts exactly one Bearer credential syntax", () => {
    expect(readBearerCredential(request({ authorization: "Bearer abc" }))).toBe("abc");
    expect(readBearerCredential(request({ authorization: "bearer abc" }))).toBeNull();
    expect(readBearerCredential(request({ authorization: "Bearer a b" }))).toBeNull();
  });

  it("attaches only the database-verified agent and manifest binding", async () => {
    const principal = await verifyBearerCredential(
      request({ authorization: "Bearer valid-secret" }),
      repository(),
      "request-1",
    );

    expect(principal).toMatchObject({
      requestId: "request-1",
      credentialId: "11000000-0000-4000-8000-000000000002",
      authMode: "bearer",
      principal: {
        kind: "agent",
        subject: "catalyst-verifier",
        manifestId: "catalyst-verifier",
        manifestVersion: "v1",
      },
      effectiveScopes: ["tool:fmp", "tool:primary-source"],
    });
  });

  it("rejects identity headers when no real credential or session exists", async () => {
    const repo = repository();
    const spy = vi.spyOn(repo, "verifyApiCredential");
    await expect(
      authenticateRequest(
        request({
          "x-principal-id": "spoofed",
          "x-principal-kind": "human",
          "x-scopes": "governance:credentials",
        }),
        anyProtectedPolicy,
        repo,
        "request-2",
        [],
      ),
    ).rejects.toMatchObject({ status: 401, code: "AUTH_REQUIRED" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns the same generic failure for unknown and malformed bearers", async () => {
    for (const authorization of ["Bearer unknown", "Token malformed"]) {
      await expect(
        verifyBearerCredential(
          request({ authorization }),
          repository(),
          "request-3",
        ),
      ).rejects.toMatchObject({ status: 401, code: "AUTH_REQUIRED" });
    }
  });
});
