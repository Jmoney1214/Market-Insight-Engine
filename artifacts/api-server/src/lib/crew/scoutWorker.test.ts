import { describe, expect, it } from "vitest";

import { runScoutWorker, type ScoutInput, type ScoutWorkerDeps } from "./scoutWorker.js";

const WINDOW_END = new Date("2026-07-13T20:00:00Z");

function input(symbol: string, over?: Partial<ScoutInput>): ScoutInput {
  return {
    symbol,
    anchorPrice: 43.74,
    anchorTs: new Date("2026-07-13T17:18:00Z"),
    priorClose: 36.7,
    spentMovePct: 19.18,
    news: [{ headline: `${symbol} phase 1b readout`, source: "GlobeNewswire", publishedAt: 1780000000 }],
    ...over,
  };
}

function modelJson(calls: unknown[]): string {
  return `Here you go:\n${JSON.stringify({ calls })}`;
}

const okCall = (ticker: string) => ({
  ticker,
  verdict: "support",
  catalystTier: "HARD",
  catalyst: "phase 1b readout, GlobeNewswire 08:00 ET",
  direction: "up",
  p: 0.65,
  magnitudeBandPct: [0.5, 3],
  evidence: ["volume confirms, 2.05M by midday"],
  risks: ["weekend gap risk"],
});

function deps(over?: Partial<ScoutWorkerDeps>): ScoutWorkerDeps & { insertedRows: unknown[] } {
  const insertedRows: unknown[] = [];
  return {
    complete: async () => modelJson([okCall("FBRX")]),
    fetchInput: async (s) => input(s),
    readMemory: async () => ["FBRX support@0.85 -> correct (0.85)"],
    insertFindings: async (rows) => {
      insertedRows.push(...rows);
      return rows.map((_, i) => 100 + i);
    },
    now: () => new Date("2026-07-13T17:20:00Z"),
    insertedRows,
    ...over,
  };
}

describe("runScoutWorker", () => {
  it("produces an anchored, schema-valid finding and inserts it", async () => {
    const d = deps();
    const result = await runScoutWorker(d, { symbols: ["FBRX"], windowEnd: WINDOW_END });
    expect(result.findings).toHaveLength(1);
    expect(result.insertedIds).toEqual([100]);
    const f = result.findings[0];
    expect(f.verdict).toBe("support");
    expect(f.confidence).toBe(0.65);
    expect(f.evidence[0]).toContain("ANCHOR: 2026-07-13T17:18:00.000Z @ 43.74");
    expect(f.evidence[0]).toContain("19.2% from prior close");
    expect(f.evidence[2]).toContain("p=0.65");
    expect((f.provenance as { source: string }).source).toBe("catalyst-scout/server");
    expect(f.eventTimestamp).toEqual(WINDOW_END);
  });

  it("dryRun validates but never inserts", async () => {
    const d = deps();
    const result = await runScoutWorker(d, { symbols: ["FBRX"], windowEnd: WINDOW_END, dryRun: true });
    expect(result.findings).toHaveLength(1);
    expect(result.insertedIds).toEqual([]);
    expect(d.insertedRows).toHaveLength(0);
  });

  it("skips symbols the model invented and symbols whose input failed", async () => {
    const d = deps({
      complete: async () => modelJson([okCall("FBRX"), okCall("HALLUCINATED")]),
      fetchInput: async (s) => {
        if (s === "BROKEN") throw new Error("no bars");
        return input(s);
      },
    });
    const result = await runScoutWorker(d, { symbols: ["FBRX", "BROKEN"], windowEnd: WINDOW_END });
    expect(result.findings).toHaveLength(1);
    expect(result.skipped.map((s) => s.symbol).sort()).toEqual(["BROKEN", "HALLUCINATED"]);
  });

  it("rejects malformed model output loudly instead of writing junk", async () => {
    const d = deps({ complete: async () => "sorry, no json here" });
    await expect(runScoutWorker(d, { symbols: ["FBRX"], windowEnd: WINDOW_END })).rejects.toThrow(
      /no JSON object/,
    );
  });

  it("rejects out-of-contract verdicts via schema, skipping that call only", async () => {
    const d = deps({
      complete: async () => modelJson([{ ...okCall("FBRX"), verdict: "BUY NOW" }]),
    });
    await expect(runScoutWorker(d, { symbols: ["FBRX"], windowEnd: WINDOW_END })).rejects.toThrow(
      /failed validation/,
    );
  });

  it("labels memory-blind runs honestly in the prompt", async () => {
    let seenUser = "";
    const d = deps({
      readMemory: async () => [],
      complete: async (_s, user) => {
        seenUser = user;
        return modelJson([okCall("FBRX")]);
      },
    });
    await runScoutWorker(d, { symbols: ["FBRX"], windowEnd: WINDOW_END });
    expect(seenUser).toContain("memory-blind");
  });
});
