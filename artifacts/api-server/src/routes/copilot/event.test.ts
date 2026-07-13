import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";

describe("GET /api/copilot/event source boundary", () => {
  beforeEach(() => {
    vi.stubEnv("ALPACA_API_KEY_ID", "");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults an omitted source and mode to read-only Alpaca LIVE", async () => {
    const res = await request(app).get("/api/copilot/event").query({ symbol: "AAPL" });

    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("LIVE");
    expect(res.body.dataSource).toBe("alpaca_live");
    expect(res.body.provenanceMode).toBe("LIVE_SIP");
  });

  it("fails closed before bundled fixture access", async () => {
    for (const symbol of ["AAPL", "ZZZ"]) {
      const res = await request(app)
        .get("/api/copilot/event")
        .query({ symbol, source: "fixture", mode: "LIVE" });

      expect(res.status).toBe(503);
      expect(res.body.code).toBe("BRAIN_AUTH_NOT_READY");
    }
  });

  it.each(["REPLAY", "RESEARCH"] as const)(
    "fails closed for %s until verified brain auth exists",
    async (mode) => {
      const res = await request(app)
        .get("/api/copilot/event")
        .query({ symbol: "AAPL", source: "alpaca_live", mode });

      expect(res.status).toBe(503);
      expect(res.body.code).toBe("BRAIN_AUTH_NOT_READY");
    },
  );

  it("rejects delayed Yahoo rather than falling back", async () => {
    const res = await request(app)
      .get("/api/copilot/event")
      .query({ symbol: "AAPL", source: "yahoo_delayed", mode: "LIVE" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("LIVE_SOURCE_REQUIRED");
  });
});
