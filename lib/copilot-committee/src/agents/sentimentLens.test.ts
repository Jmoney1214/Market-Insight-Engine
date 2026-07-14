import { describe, it, expect } from "vitest";
import { buildCopilotEvent } from "@workspace/copilot-core";
import { sentimentAgent } from "./sentiment";
import { runAgents, readsToArray } from "./index";
import type { SentimentLensInput } from "../types";

const event = () =>
  buildCopilotEvent({
    symbol: "RGTI",
    mode: "LIVE",
    dataSource: "test",
    bars: [],
    quote: null,
  });

const reading: SentimentLensInput = {
  band: "BULLISH",
  score: 0.55,
  confidence: 0.7,
  sources: [
    { kind: "NEWS", itemCount: 9 },
    { kind: "REDDIT", itemCount: 22 },
  ],
  isEventProof: false,
};

describe("sentiment lens (11th agent)", () => {
  it("is UNAVAILABLE without an injected reading — it never scores on its own", () => {
    const read = sentimentAgent(event(), null);
    expect(read.agent).toBe("sentiment");
    expect(read.status).toBe("UNAVAILABLE");
    expect(read.bias).toBe("UNKNOWN");
    expect(read.confidence).toBe(0);
  });

  it("renders an injected grounded reading with the attention-only warning", () => {
    const read = sentimentAgent(event(), reading);
    expect(read.status).toBe("OK");
    expect(read.bias).toBe("BULLISH");
    expect(read.confidence).toBe(0.7);
    expect(read.headline).toContain("BULLISH");
    expect(read.warnings.some((w) => w.includes("never proof"))).toBe(true);
  });

  it("runAgents includes it and readsToArray returns eleven reads in order", () => {
    const reads = runAgents(event(), { sentiment: reading });
    const arr = readsToArray(reads);
    expect(arr).toHaveLength(11);
    expect(arr.map((r) => r.agent)).toEqual([
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
    ]);
  });

  it("defaults to UNAVAILABLE when runAgents gets no extras (back-compat)", () => {
    const reads = runAgents(event());
    expect(reads.sentiment.status).toBe("UNAVAILABLE");
  });
});

describe("decision memory on the memory lens", () => {
  it("attaches rendered verdict lines as factors without changing status", () => {
    const lines = [
      "2026-07-12 research DEEP: PARTIAL → outcome pending",
      "2026-07-10 research STANDARD: COMPLETE → judges 90",
    ];
    const reads = runAgents(event(), { decisionMemory: lines });
    expect(reads.memory.status).toBe("UNAVAILABLE"); // no validation sample in fixture
    expect(reads.memory.supportingFactors).toEqual(lines.map((l) => `Decision memory: ${l}`));
  });

  it("no decision memory → memory lens unchanged", () => {
    const reads = runAgents(event());
    expect(reads.memory.supportingFactors).toEqual([]);
  });
});
