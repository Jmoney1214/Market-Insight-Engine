import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import type { AuthRepository } from "./types.js";
import { unavailableHistoricalCasePort } from "./historicalCasePort.js";

const humanIdentity = {
  principalId: "12000000-0000-4000-8000-000000000001",
  credentialId: "12000000-0000-4000-8000-000000000002",
  principalKind: "human" as const,
  subject: "desk-operator",
  scopes: ["desk:read", "governance:credentials"],
};

function sessionRepository(kind: "human" | "service" = "human") {
  const createBrowserSession = vi.fn<AuthRepository["createBrowserSession"]>(
    async () => "12000000-0000-4000-8000-000000000003",
  );
  const revokeBrowserSession = vi.fn<AuthRepository["revokeBrowserSession"]>(
    async () => undefined,
  );
  const repository: AuthRepository = {
    async verifyApiCredential(secret) {
      if (secret !== "permanent-human-key") return null;
      return { ...humanIdentity, principalKind: kind };
    },
    async verifyBrowserSession(session, csrf) {
      if (!session.startsWith("session-") || !csrf.startsWith("csrf-")) return null;
      return {
        ...humanIdentity,
        sessionId: "12000000-0000-4000-8000-000000000003",
      };
    },
    async recordRequestStart() {
      return "12000000-0000-4000-8000-000000000004";
    },
    async completeRequest() {},
    async claimIdempotency() {
      throw new Error("unused");
    },
    createBrowserSession,
    revokeBrowserSession,
  };
  return { repository, createBrowserSession, revokeBrowserSession };
}

describe("human browser sessions", () => {
  it("creates opaque strict secure session and CSRF cookies from a permanent human bearer", async () => {
    const fixture = sessionRepository();
    const app = createApp({
      repository: fixture.repository,
      allowedOrigins: ["https://desk.test"],
      historicalCasePort: unavailableHistoricalCasePort,
    });

    const response = await request(app)
      .post("/api/auth/session")
      .set("Authorization", "Bearer permanent-human-key")
      .expect(201);

    const cookies = response.headers["set-cookie"] as unknown as string[];
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toMatch(/mie_session=.*; Path=\/api; HttpOnly; Secure; SameSite=Strict/);
    expect(cookies[1]).toMatch(/mie_csrf=.*; Path=\/; Secure; SameSite=Strict/);
    expect(JSON.stringify(response.body)).not.toContain("permanent-human-key");

    const input = fixture.createBrowserSession.mock.calls[0]?.[0];
    expect(input?.rawSessionToken).toHaveLength(43);
    expect(input?.rawCsrfToken).toHaveLength(43);
    expect(input?.rawSessionToken).not.toBe(input?.rawCsrfToken);
    expect(input?.expiresAt).toBeUndefined();
  });

  it("requires same-origin CSRF binding and revokes only the current session", async () => {
    const fixture = sessionRepository();
    const app = createApp({
      repository: fixture.repository,
      allowedOrigins: ["https://desk.test"],
      historicalCasePort: unavailableHistoricalCasePort,
    });
    const session = `session-${"a".repeat(40)}`;
    const csrf = `csrf-${"b".repeat(40)}`;

    await request(app)
      .delete("/api/auth/session")
      .set("Cookie", `mie_session=${session}; mie_csrf=${csrf}`)
      .set("Origin", "https://desk.test")
      .set("X-CSRF-Token", csrf)
      .expect(204);

    expect(fixture.revokeBrowserSession).toHaveBeenCalledOnce();
    expect(fixture.revokeBrowserSession.mock.calls[0]?.[1]).toBe(
      "12000000-0000-4000-8000-000000000003",
    );
  });

  it("rejects a missing CSRF header before session revocation", async () => {
    const fixture = sessionRepository();
    const app = createApp({
      repository: fixture.repository,
      allowedOrigins: ["https://desk.test"],
      historicalCasePort: unavailableHistoricalCasePort,
    });

    const response = await request(app)
      .delete("/api/auth/session")
      .set(
        "Cookie",
        `mie_session=session-${"a".repeat(40)}; mie_csrf=csrf-${"b".repeat(40)}`,
      )
      .set("Origin", "https://desk.test");

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("AUTH_FORBIDDEN");
    expect(fixture.revokeBrowserSession).not.toHaveBeenCalled();
  });

  it("never gives a service bearer browser cookies", async () => {
    const fixture = sessionRepository("service");
    const app = createApp({ repository: fixture.repository, allowedOrigins: [], historicalCasePort: unavailableHistoricalCasePort });

    const response = await request(app)
      .post("/api/auth/session")
      .set("Authorization", "Bearer permanent-human-key");

    expect(response.status).toBe(403);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(fixture.createBrowserSession).not.toHaveBeenCalled();
  });
});
