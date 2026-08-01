import { describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../lib/accuracyStore.js", () => ({
  computeAgentAccuracy: vi.fn().mockResolvedValue([]),
}));

vi.mock("../lib/researchRunner.js", () => ({
  runResearch: vi
    .fn()
    .mockResolvedValue({ marker: "wrong research-symbol route" }),
}));

vi.mock("../lib/researchStore.js", () => ({
  persistLeadRun: vi.fn().mockResolvedValue(true),
}));

vi.mock("../lib/judgeStore.js", () => ({
  judgeLeadRun: vi.fn().mockResolvedValue([]),
}));

vi.mock("../lib/memoryStore.js", () => ({
  recordResearchEpisode: vi.fn().mockResolvedValue(undefined),
}));

describe("research route precedence", () => {
  it("routes /research/accuracy to the accuracy ranker, not symbol research", async () => {
    const { default: app } = await import("../app.js");

    const response = await request(app).get("/api/research/accuracy");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      windowDays: 30,
      source: "live",
      contaminationWarning: null,
      agents: [],
    });
  }, 30_000);
});
