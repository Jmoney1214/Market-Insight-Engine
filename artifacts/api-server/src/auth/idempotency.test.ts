import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { canonicalRequestHash } from "./idempotency.js";
import type { AuthRepository } from "./types.js";
import { unavailableHistoricalCasePort } from "./historicalCasePort.js";

function repository(
  claim: Awaited<ReturnType<AuthRepository["claimIdempotency"]>> | Error,
) {
  const completeRequest = vi.fn<AuthRepository["completeRequest"]>(
    async () => undefined,
  );
  const authRepository: AuthRepository = {
    async verifyApiCredential(secret) {
      if (secret !== "human-key") return null;
      return {
        principalId: "13000000-0000-4000-8000-000000000001",
        credentialId: "13000000-0000-4000-8000-000000000002",
        principalKind: "human",
        subject: "desk-operator",
        scopes: ["report:write"],
      };
    },
    async verifyBrowserSession() {
      return null;
    },
    async recordRequestStart() {
      return "13000000-0000-4000-8000-000000000003";
    },
    completeRequest,
    async claimIdempotency() {
      if (claim instanceof Error) throw claim;
      return claim;
    },
    async createBrowserSession() {
      throw new Error("unused");
    },
    async revokeBrowserSession() {
      throw new Error("unused");
    },
  };
  return { authRepository, completeRequest };
}

describe("idempotency middleware", () => {
  it("requires a key before an idempotent handler runs", async () => {
    const fixture = repository({
      status: "CLAIMED",
      idempotencyRecordId: "13000000-0000-4000-8000-000000000004",
    });
    const app = createApp({ repository: fixture.authRepository, allowedOrigins: [], historicalCasePort: unavailableHistoricalCasePort });

    const response = await request(app)
      .post("/api/analyze")
      .set("Authorization", "Bearer human-key")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("persists the terminal response before sending it", async () => {
    const fixture = repository({
      status: "CLAIMED",
      idempotencyRecordId: "13000000-0000-4000-8000-000000000004",
    });
    const app = createApp({ repository: fixture.authRepository, allowedOrigins: [], historicalCasePort: unavailableHistoricalCasePort });

    const response = await request(app)
      .post("/api/analyze")
      .set("Authorization", "Bearer human-key")
      .set("Idempotency-Key", "analyze-one")
      .send({});

    expect(response.status).toBe(400);
    expect(fixture.completeRequest).toHaveBeenCalledOnce();
    expect(fixture.completeRequest.mock.calls[0]?.[2]).toMatchObject({
      principalId: "13000000-0000-4000-8000-000000000001",
      operationId: "analyzeTicker",
      idempotencyKey: "analyze-one",
      responseStatus: 400,
      responseBody: { error: "Invalid request: ticker is required" },
    });
  });

  it("replays a completed response without executing the handler", async () => {
    const fixture = repository({
      status: "REPLAY",
      idempotencyRecordId: "13000000-0000-4000-8000-000000000004",
      completionRecordId: "13000000-0000-4000-8000-000000000005",
      responseStatus: 202,
      responseBody: { runId: "existing-run" },
    });
    const app = createApp({ repository: fixture.authRepository, allowedOrigins: [], historicalCasePort: unavailableHistoricalCasePort });

    const response = await request(app)
      .post("/api/analyze")
      .set("Authorization", "Bearer human-key")
      .set("Idempotency-Key", "analyze-replay")
      .send({ ticker: "AAPL" });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ runId: "existing-run" });
    expect(fixture.completeRequest.mock.calls[0]?.[2]).toBeUndefined();
  });

  it("maps conflicts and active requests to distinct 409 codes", async () => {
    for (const [claim, code] of [
      [new Error("idempotency_conflict"), "IDEMPOTENCY_CONFLICT"],
      [
        {
          status: "IN_PROGRESS" as const,
          idempotencyRecordId: "13000000-0000-4000-8000-000000000004",
        },
        "IDEMPOTENCY_IN_PROGRESS",
      ],
    ] as const) {
      const fixture = repository(claim);
      const app = createApp({ repository: fixture.authRepository, allowedOrigins: [], historicalCasePort: unavailableHistoricalCasePort });
      const response = await request(app)
        .post("/api/analyze")
        .set("Authorization", "Bearer human-key")
        .set("Idempotency-Key", "same-key")
        .send({ ticker: "AAPL" });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe(code);
    }
  });

  it("canonicalizes object key order while retaining operation and input changes", () => {
    const left = canonicalRequestHash(
      {
        method: "POST",
        path: "/analyze",
        query: { b: "2", a: "1" },
        body: { ticker: "AAPL", options: { b: 2, a: 1 } },
      } as never,
      "analyzeTicker",
    );
    const reordered = canonicalRequestHash(
      {
        method: "POST",
        path: "/analyze",
        query: { a: "1", b: "2" },
        body: { options: { a: 1, b: 2 }, ticker: "AAPL" },
      } as never,
      "analyzeTicker",
    );
    const changed = canonicalRequestHash(
      {
        method: "POST",
        path: "/analyze",
        query: { a: "1", b: "2" },
        body: { ticker: "MSFT" },
      } as never,
      "analyzeTicker",
    );

    expect(reordered).toBe(left);
    expect(changed).not.toBe(left);
  });
});
