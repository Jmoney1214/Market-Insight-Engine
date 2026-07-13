// API-boundary tests for the analyst committee endpoints (spec §21 items 12, 13,
// 18, 23, 31). Uses supertest against the default-exported Express app (which
// never calls listen()). With no AI integration configured in the test
// environment, the committee must still return its full deterministic
// multi-agent read, and nothing non-finite may ever reach the JSON wire.

import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../app.js";
import {
  APPROVED_RECOMMENDATIONS,
  BLOCKED_ALLOWED_RECOMMENDATIONS,
} from "@workspace/copilot-committee/vocab";

const AGENT_NAMES = [
  "technical",
  "pattern",
  "regime",
  "order_flow",
  "catalyst",
  "position",
  "memory",
  "sentiment",
  "bull_case",
  "bear_case",
  "risk_critic",
];

function assertAllFinite(value: unknown, path = "$"): void {
  if (typeof value === "number") {
    expect(Number.isFinite(value), `non-finite number at ${path}`).toBe(true);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => assertAllFinite(v, `${path}[${i}]`));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) assertAllFinite(v, `${path}.${k}`);
  }
}

describe("GET /api/copilot/explain (items 12, 13, 18)", () => {
  it("returns the full multi-agent committee read for a fixture symbol", async () => {
    const res = await request(app)
      .get("/api/copilot/explain")
      .query({ symbol: "AAPL", source: "fixture" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("OK");
    // item 12: genuine multi-agent committee output (not the safety-net fallback).
    expect(res.body.source).toBe("multi_agent_committee");
    // items 13 & 18: no AI integration configured -> deterministic provider.
    expect(res.body.provider).toBe("deterministic");
    expect(Array.isArray(res.body.agents)).toBe(true);
    expect(res.body.agents).toHaveLength(11);
    expect(
      res.body.agents.map((a: { agent: string }) => a.agent).sort(),
    ).toEqual([...AGENT_NAMES].sort());
    expect(APPROVED_RECOMMENDATIONS as readonly string[]).toContain(
      res.body.dashboardRead.recommendation,
    );
  });

  it("never serializes NaN / Infinity (item 31, response boundary)", async () => {
    const res = await request(app)
      .get("/api/copilot/explain")
      .query({ symbol: "AAPL", source: "fixture" });

    expect(res.status).toBe(200);
    // Valid JSON parsing by supertest already proves there are no bare
    // NaN/Infinity tokens; assert explicitly on the raw text and every leaf.
    expect(res.text).not.toMatch(/\bNaN\b|\bInfinity\b/);
    assertAllFinite(res.body);
  });

  it("keeps an L5-blocked symbol pinned to defensive recommendations (item 10)", async () => {
    const res = await request(app)
      .get("/api/copilot/explain")
      .query({ symbol: "MSFT", source: "fixture" });

    expect(res.status).toBe(200);
    expect(res.body.l5Blocked).toBe(true);
    expect(BLOCKED_ALLOWED_RECOMMENDATIONS as readonly string[]).toContain(
      res.body.dashboardRead.recommendation,
    );
  });

  it("rejects an invalid symbol with 400", async () => {
    const res = await request(app)
      .get("/api/copilot/explain")
      .query({ symbol: "123$", source: "fixture" });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown fixture symbol", async () => {
    const res = await request(app)
      .get("/api/copilot/explain")
      .query({ symbol: "ZZZ", source: "fixture" });
    expect(res.status).toBe(404);
  });
});

describe("replay surface requires no API keys (items 12, 23)", () => {
  it("loads a fixture replay session without any credentials", async () => {
    const res = await request(app)
      .get("/api/copilot/replay/session")
      .query({ symbol: "AAPL" });

    expect(res.status).toBe(200);
    expect(res.body.totalSteps).toBeGreaterThan(0);
    expect(typeof res.body.date).toBe("string");
  });

  it("explains a replay step with the deterministic committee (no keys)", async () => {
    const session = await request(app)
      .get("/api/copilot/replay/session")
      .query({ symbol: "AAPL" });
    expect(session.status).toBe(200);

    const res = await request(app)
      .get("/api/copilot/replay/explain")
      .query({ symbol: "AAPL", date: session.body.date, step: 1 });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("multi_agent_committee");
    expect(res.body.provider).toBe("deterministic");
    expect(res.body.agents).toHaveLength(11);
    expect(res.text).not.toMatch(/\bNaN\b|\bInfinity\b/);
  });
});

// Data-plane contract: paid feeds only. Yahoo delayed bars must be rejected at
// the API boundary unless explicitly re-enabled via ALLOW_DELAYED_YAHOO=true.
describe("data-plane contract (yahoo_delayed gate)", () => {
  it("rejects yahoo_delayed on /copilot/explain", async () => {
    const res = await request(app)
      .get("/api/copilot/explain")
      .query({ symbol: "HIMS", source: "yahoo_delayed" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/data-plane contract/);
  });

  it("rejects yahoo_delayed on /copilot/event", async () => {
    const res = await request(app)
      .get("/api/copilot/event")
      .query({ symbol: "HIMS", source: "yahoo_delayed" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/data-plane contract/);
  });
});
