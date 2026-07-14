import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";
import { createTestAuthRuntime, TEST_BEARER } from "../../auth/testSupport.js";

const app = createApp(
  createTestAuthRuntime({ scopes: ["event:generate", "replay:read"] }),
);

function eventRequest() {
  return request(app)
    .get("/api/copilot/event")
    .set("Authorization", `Bearer ${TEST_BEARER}`)
    .set("Idempotency-Key", crypto.randomUUID());
}

describe("GET /api/copilot/event source boundary", () => {
  beforeEach(() => {
    vi.stubEnv("ALPACA_API_KEY_ID", "");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults an omitted source and mode to read-only Alpaca LIVE", async () => {
    const res = await eventRequest().query({ symbol: "AAPL" });

    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("LIVE");
    expect(res.body.dataSource).toBe("alpaca_live");
    expect(res.body.provenanceMode).toBe("LIVE_SIP");
  });

  it("rejects fixture data in LIVE mode", async () => {
    for (const symbol of ["AAPL", "ZZZ"]) {
      const res = await eventRequest()
        .query({ symbol, source: "fixture", mode: "LIVE" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("LIVE_SOURCE_REQUIRED");
    }
  });

  it.each(["REPLAY", "RESEARCH"] as const)(
    "rejects a live source in %s mode",
    async (mode) => {
      const res = await eventRequest()
        .query({ symbol: "AAPL", source: "alpaca_live", mode });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("LIVE_SOURCE_REQUIRED");
    },
  );

  it.each(["REPLAY", "RESEARCH"] as const)(
    "fails closed with BRAIN_UNAVAILABLE for a canonical %s request",
    async (mode) => {
      const res = await eventRequest().query({
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

  it("requires exact canonical identifiers for historical reads", async () => {
    const res = await eventRequest().query({
      symbol: "AAPL",
      source: "fixture",
      mode: "REPLAY",
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("CANONICAL_CASE_REQUIRED");
  });

  it("rejects delayed Yahoo rather than falling back", async () => {
    const res = await eventRequest()
      .query({ symbol: "AAPL", source: "yahoo_delayed", mode: "LIVE" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("LIVE_SOURCE_REQUIRED");
  });
});
