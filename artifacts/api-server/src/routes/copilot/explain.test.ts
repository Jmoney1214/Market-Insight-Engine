import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";
import { createTestAuthRuntime, TEST_BEARER } from "../../auth/testSupport.js";

const app = createApp(
  createTestAuthRuntime({
    scopes: ["event:generate", "committee:run", "replay:read"],
  }),
);

function authorizedGet(path: string, idempotent = false) {
  const pending = request(app)
    .get(path)
    .set("Authorization", `Bearer ${TEST_BEARER}`);
  return idempotent
    ? pending.set("Idempotency-Key", crypto.randomUUID())
    : pending;
}

describe("GET /api/copilot/explain source boundary", () => {
  beforeEach(() => {
    vi.stubEnv("ALPACA_API_KEY_ID", "");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults an omitted source and mode to read-only Alpaca LIVE", async () => {
    const res = await authorizedGet("/api/copilot/explain", true).query({ symbol: "AAPL" });

    expect(res.status).toBe(200);
    expect(res.body.eventId).toContain(":LIVE:");
    expect(res.body.provenanceMode).toBe("LIVE_SIP");
  });

  it("rejects fixture data in LIVE mode", async () => {
    for (const symbol of ["AAPL", "ZZZ"]) {
      const res = await authorizedGet("/api/copilot/explain", true)
        .query({ symbol, source: "fixture", mode: "LIVE" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("LIVE_SOURCE_REQUIRED");
    }
  });

  it.each(["REPLAY", "RESEARCH"] as const)(
    "rejects a live source in %s mode",
    async (mode) => {
      const res = await authorizedGet("/api/copilot/explain", true)
        .query({ symbol: "AAPL", source: "alpaca_live", mode });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("LIVE_SOURCE_REQUIRED");
    },
  );

  it.each(["REPLAY", "RESEARCH"] as const)(
    "fails closed with BRAIN_UNAVAILABLE for a canonical %s request",
    async (mode) => {
      const res = await authorizedGet("/api/copilot/explain", true).query({
        symbol: "AAPL",
        source: "fixture",
        mode,
        caseRevisionId: "case-revision-1",
        evidenceHash: "sha256:evidence-1",
      });

      expect(res.status).toBe(503);
      expect(res.body.code).toBe("BRAIN_UNAVAILABLE");
    },
  );

  it("rejects delayed Yahoo rather than falling back", async () => {
    const res = await authorizedGet("/api/copilot/explain", true)
      .query({ symbol: "AAPL", source: "yahoo_delayed", mode: "LIVE" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("LIVE_SOURCE_REQUIRED");
  });

  it("rejects an invalid symbol before source resolution", async () => {
    const res = await authorizedGet("/api/copilot/explain", true)
      .query({ symbol: "123$", source: "fixture" });

    expect(res.status).toBe(400);
  });
});

describe("GET /api/copilot/replay canonical brain boundary", () => {
  it.each([
    ["/api/copilot/replay/session", { symbol: "AAPL" }],
    ["/api/copilot/replay/event", { symbol: "AAPL", date: "2024-06-03", step: 0 }],
    ["/api/copilot/replay/explain", { symbol: "AAPL", date: "2024-06-03", step: 0 }],
  ])("fails closed at %s when the canonical brain is unavailable", async (path, query) => {
    const res = await authorizedGet(
      path,
      path === "/api/copilot/replay/explain",
    ).query({
      ...query,
      caseRevisionId: "case-revision-1",
      evidenceHash: "sha256:evidence-1",
    });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("BRAIN_UNAVAILABLE");
  });
});
