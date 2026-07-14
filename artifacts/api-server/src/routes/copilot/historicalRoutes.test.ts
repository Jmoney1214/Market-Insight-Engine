import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type {
  HistoricalCase,
  HistoricalCasePort,
} from "../../auth/historicalCasePort.js";
import { createTestAuthRuntime, TEST_BEARER } from "../../auth/testSupport.js";
import { createApp } from "../../app.js";

const CASE_REVISION_ID = "case-revision-aapl-2024-06-03-v1";
const EVIDENCE_HASH = "sha256:aapl-evidence-v1";
const DATE = "2024-06-03";

function canonicalCase(overrides: Partial<HistoricalCase> = {}): HistoricalCase {
  const bars = [
    { t: 1_717_414_200, o: 100, h: 101, l: 99.5, c: 100.5, v: 10_000 },
    { t: 1_717_414_500, o: 100.5, h: 102, l: 100, c: 101.5, v: 14_000 },
  ];
  return {
    caseRevisionId: CASE_REVISION_ID,
    evidenceHash: EVIDENCE_HASH,
    session: {
      symbol: "AAPL",
      date: DATE,
      availableDates: [DATE],
      dataSource: "fixture",
      totalSteps: bars.length,
      barSeconds: 300,
      startTime: bars[0]!.t,
      endTime: bars.at(-1)!.t,
    },
    input: {
      symbol: "AAPL",
      mode: "REPLAY",
      dataSource: "fixture",
      bars,
      quote: {
        bid: 101.49,
        ask: 101.51,
        last: 101.5,
        quoteTime: bars.at(-1)!.t,
      },
      nowMs: bars.at(-1)!.t * 1_000,
    },
    ...overrides,
  };
}

const resolveReplayCase = vi.fn<HistoricalCasePort["resolveReplayCase"]>();
const app = createApp(
  createTestAuthRuntime({
    scopes: ["event:generate", "committee:run", "replay:read"],
    historicalCasePort: { resolveReplayCase },
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

const canonicalQuery = {
  caseRevisionId: CASE_REVISION_ID,
  evidenceHash: EVIDENCE_HASH,
};

beforeEach(() => {
  resolveReplayCase.mockReset();
  resolveReplayCase.mockResolvedValue(canonicalCase());
});

describe("canonical historical case routing", () => {
  it.each([
    "/api/copilot/event",
    "/api/copilot/explain",
  ])("resolves %s through the injected brain port with exact lineage", async (path) => {
    const res = await authorizedGet(path, true).query({
      symbol: "AAPL",
      source: "fixture",
      mode: "REPLAY",
      ...canonicalQuery,
    });

    expect(res.status).toBe(200);
    expect(res.body.provenanceMode).toBe("HISTORICAL_FIXTURE");
    expect(res.body.caseRevisionId).toBe(CASE_REVISION_ID);
    expect(res.body.evidenceHash).toBe(EVIDENCE_HASH);
    expect(resolveReplayCase).toHaveBeenLastCalledWith(
      {
        symbol: "AAPL",
        caseRevisionId: CASE_REVISION_ID,
        evidenceHash: EVIDENCE_HASH,
      },
      expect.objectContaining({
        effectiveScopes: expect.arrayContaining(["replay:read"]),
      }),
    );
  });

  it("returns exact replay session metadata from the brain", async () => {
    const res = await authorizedGet("/api/copilot/replay/session").query({
      symbol: "AAPL",
      date: DATE,
      ...canonicalQuery,
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      symbol: "AAPL",
      date: DATE,
      dataSource: "fixture",
      caseRevisionId: CASE_REVISION_ID,
      evidenceHash: EVIDENCE_HASH,
      totalSteps: 2,
    });
  });

  it.each([
    ["/api/copilot/replay/event", false],
    ["/api/copilot/replay/explain", true],
  ] as const)("resolves %s at the exact replay step", async (path, idempotent) => {
    const res = await authorizedGet(path, idempotent).query({
      symbol: "AAPL",
      date: DATE,
      step: 1,
      ...canonicalQuery,
    });

    expect(res.status).toBe(200);
    expect(res.body.provenanceMode).toBe("HISTORICAL_FIXTURE");
    expect(res.body.caseRevisionId).toBe(CASE_REVISION_ID);
    expect(res.body.evidenceHash).toBe(EVIDENCE_HASH);
    expect(resolveReplayCase).toHaveBeenLastCalledWith(
      {
        symbol: "AAPL",
        date: DATE,
        step: 1,
        caseRevisionId: CASE_REVISION_ID,
        evidenceHash: EVIDENCE_HASH,
      },
      expect.any(Object),
    );
  });

  it("rejects a brain response whose evidence hash does not match", async () => {
    resolveReplayCase.mockResolvedValueOnce(
      canonicalCase({ evidenceHash: "sha256:different-evidence" }),
    );

    const res = await authorizedGet("/api/copilot/replay/event").query({
      symbol: "AAPL",
      date: DATE,
      step: 1,
      ...canonicalQuery,
    });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("BRAIN_INTEGRITY_FAILURE");
  });

  it("rejects a brain response that is not fixture-tagged", async () => {
    resolveReplayCase.mockResolvedValueOnce(
      canonicalCase({
        input: {
          ...canonicalCase().input,
          dataSource: "fixture_replay",
        },
      }),
    );

    const res = await authorizedGet("/api/copilot/event", true).query({
      symbol: "AAPL",
      source: "fixture",
      mode: "REPLAY",
      ...canonicalQuery,
    });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("BRAIN_INTEGRITY_FAILURE");
  });
});
