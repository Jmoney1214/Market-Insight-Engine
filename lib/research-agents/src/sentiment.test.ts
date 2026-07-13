import { describe, it, expect } from "vitest";
import { bandFromScore, coverageCap, readSentiment, type GroundedBlock, type SentimentProvider } from "./sentiment";

const NOW = "2026-07-13T09:15:00-04:00";

const blocks: GroundedBlock[] = [
  { blockId: "b1", kind: "NEWS", text: "RGTI wins $50M contract", publishedAt: NOW },
  { blockId: "b2", kind: "REDDIT", text: "RGTI to the moon", publishedAt: NOW },
  { blockId: "b3", kind: "X", text: "$RGTI breaking out", publishedAt: NOW },
];

const provider = (raw: unknown): SentimentProvider => ({ name: "fake", score: async () => raw });

describe("bandFromScore (deterministic mapping)", () => {
  it("maps score ranges to bands", () => {
    expect(bandFromScore(-1)).toBe("STRONG_BEARISH");
    expect(bandFromScore(-0.4)).toBe("BEARISH");
    expect(bandFromScore(0)).toBe("NEUTRAL");
    expect(bandFromScore(0.4)).toBe("BULLISH");
    expect(bandFromScore(0.9)).toBe("STRONG_BULLISH");
  });
});

describe("readSentiment", () => {
  it("builds a grounded reading: band from score, counts from blocks, isEventProof false", async () => {
    const reading = await readSentiment({
      readingId: "sent_t1",
      symbol: "RGTI",
      blocks,
      provider: provider({ score: 0.5, confidence: 0.9, citedBlockIds: ["b1", "b2"] }),
      now: NOW,
    });
    expect(reading).not.toBeNull();
    expect(reading!.band).toBe("BULLISH"); // derived by code, not the provider
    expect(reading!.isEventProof).toBe(false);
    expect(reading!.sources).toEqual([
      { kind: "NEWS", itemCount: 1 },
      { kind: "REDDIT", itemCount: 1 },
      { kind: "X", itemCount: 1 },
    ]);
    // Coverage cap: 3 blocks → confidence ≤ 0.6 even though provider said 0.9.
    expect(reading!.confidence).toBeCloseTo(coverageCap(3), 5);
  });

  it("returns null with no blocks or no provider — a reading is never fabricated", async () => {
    expect(await readSentiment({ readingId: "s", symbol: "RGTI", blocks: [], provider: provider({}), now: NOW })).toBeNull();
    expect(await readSentiment({ readingId: "s", symbol: "RGTI", blocks, now: NOW })).toBeNull();
  });

  it("rejects citations of blocks that were never provided (grounding gate)", async () => {
    const reading = await readSentiment({
      readingId: "s",
      symbol: "RGTI",
      blocks,
      provider: provider({ score: 0.5, confidence: 0.5, citedBlockIds: ["b1", "hallucinated"] }),
      now: NOW,
    });
    expect(reading).toBeNull();
  });

  it("rejects schema-violating or crashing providers", async () => {
    expect(
      await readSentiment({ readingId: "s", symbol: "RGTI", blocks, provider: provider({ score: 5 }), now: NOW }),
    ).toBeNull();
    const crash: SentimentProvider = { name: "boom", score: async () => { throw new Error("x"); } };
    expect(await readSentiment({ readingId: "s", symbol: "RGTI", blocks, provider: crash, now: NOW })).toBeNull();
  });
});
