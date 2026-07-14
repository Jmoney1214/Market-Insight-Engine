import request from "supertest";
import { describe, expect, it } from "vitest";
import type { AuthRepository } from "./types.js";
import { createApp } from "../app.js";
import { unavailableHistoricalCasePort } from "./historicalCasePort.js";

function repository(scopes: readonly string[] = []): AuthRepository {
  return {
    async verifyApiCredential(rawSecret) {
      if (rawSecret !== "valid-service") return null;
      return {
        principalId: "10000000-0000-4000-8000-000000000001",
        credentialId: "10000000-0000-4000-8000-000000000002",
        principalKind: "service",
        subject: "route-matrix-service",
        scopes,
      };
    },
    async verifyBrowserSession() {
      return null;
    },
    async recordRequestStart() {
      return "10000000-0000-4000-8000-000000000003";
    },
    async completeRequest() {},
    async claimIdempotency() {
      return {
        status: "CLAIMED",
        idempotencyRecordId: "10000000-0000-4000-8000-000000000004",
      };
    },
    async createBrowserSession() {
      throw new Error("unused");
    },
    async revokeBrowserSession() {
      throw new Error("unused");
    },
  };
}

describe("API route protection matrix", () => {
  it("leaves only the two shallow health operations public", async () => {
    const app = createApp({ repository: repository(), allowedOrigins: [], historicalCasePort: unavailableHistoricalCasePort });
    await request(app).get("/api/healthz").expect(200);
    await request(app).get("/api/copilot/healthz").expect(200);

    const reports = await request(app).get("/api/reports");
    const history = await request(app).get("/api/copilot/history");

    expect(reports.status).toBe(401);
    expect(history.status).toBe(401);
  });

  it("returns 403 for a verified service without the operation scope", async () => {
    const app = createApp({ repository: repository(), allowedOrigins: [], historicalCasePort: unavailableHistoricalCasePort });
    const response = await request(app)
      .get("/api/copilot/history")
      .set("Authorization", "Bearer valid-service");

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("AUTH_FORBIDDEN");
  });
});
