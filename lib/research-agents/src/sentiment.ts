/**
 * Sentiment Analyst — TradingAgents grounded pattern. The agent NEVER searches:
 * it scores only the pre-fetched blocks injected here (news + Reddit + X
 * adapters upstream). The provider returns a score and cited block ids; this
 * file deterministically derives the band from the score, clamps confidence by
 * coverage, verifies every citation is a real input block, and pins
 * isEventProof=false (attention is never event proof — system rule).
 *
 * No blocks or no provider → null. A sentiment reading is never fabricated.
 */
import { z } from "zod/v4";
import type { SentimentReading } from "@workspace/research-contracts";

export type AttentionKind = "NEWS" | "REDDIT" | "X" | "OTHER_SOCIAL";

export interface GroundedBlock {
  blockId: string;
  kind: AttentionKind;
  text: string;
  publishedAt: string | null;
}

export const SentimentScore = z.strictObject({
  score: z.number().min(-1).max(1),
  confidence: z.number().min(0).max(1),
  citedBlockIds: z.array(z.string().min(1)).min(1),
});
export type SentimentScore = z.infer<typeof SentimentScore>;

export interface SentimentProvider {
  name: string;
  score(input: { symbol: string; blocks: GroundedBlock[] }): Promise<unknown>;
}

/** Deterministic score→band mapping; the provider's own band label is ignored. */
export function bandFromScore(score: number): SentimentReading["band"] {
  if (score <= -0.6) return "STRONG_BEARISH";
  if (score <= -0.2) return "BEARISH";
  if (score < 0.2) return "NEUTRAL";
  if (score < 0.6) return "BULLISH";
  return "STRONG_BULLISH";
}

/** Confidence is capped by evidence coverage: thin block sets cap it hard. */
export function coverageCap(blockCount: number): number {
  return Math.min(1, blockCount / 5);
}

export interface ReadSentimentInput {
  readingId: string;
  symbol: string;
  blocks: GroundedBlock[];
  provider?: SentimentProvider | null;
  now: string;
}

export async function readSentiment(input: ReadSentimentInput): Promise<SentimentReading | null> {
  if (input.blocks.length === 0 || !input.provider) return null;

  let parsed: SentimentScore;
  try {
    const raw = await input.provider.score({ symbol: input.symbol, blocks: input.blocks });
    const result = SentimentScore.safeParse(raw);
    if (!result.success) return null;
    parsed = result.data;
  } catch {
    return null;
  }

  // Grounding: every cited block must be one we actually provided.
  const known = new Set(input.blocks.map((b) => b.blockId));
  if (!parsed.citedBlockIds.every((id) => known.has(id))) return null;

  const counts = new Map<AttentionKind, number>();
  for (const b of input.blocks) counts.set(b.kind, (counts.get(b.kind) ?? 0) + 1);

  return {
    contract: "SentimentReading",
    version: "1.0.0",
    readingId: input.readingId,
    symbol: input.symbol,
    band: bandFromScore(parsed.score),
    score: parsed.score,
    confidence: Math.min(parsed.confidence, coverageCap(input.blocks.length)),
    sources: [...counts.entries()].map(([kind, itemCount]) => ({ kind, itemCount })),
    evidenceIds: [...new Set(parsed.citedBlockIds)],
    isEventProof: false,
    asOf: input.now,
  };
}
