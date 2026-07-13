/**
 * Grounded sentiment context for the committee's 11th lens — NEWS ONLY.
 *
 * Blocks come exclusively from the news_events ledger (Alpaca news, already
 * clustered and first-seen stamped); no social sources are consulted. The
 * reading is produced by research-agents' readSentiment (deterministic band,
 * coverage-capped confidence, grounding-checked citations) and cached briefly.
 * Anything missing — no provider, no recent news — yields null and the lens
 * renders UNAVAILABLE. Never fabricated, never blocking.
 */
import { db, newsEventsTable } from "@workspace/db";
import { and, gte, desc, sql } from "drizzle-orm";
import { readSentiment, type GroundedBlock } from "@workspace/research-agents";
import type { SentimentReading } from "@workspace/research-contracts";
import type { SentimentLensInput } from "@workspace/copilot-committee";
import { getSentimentProvider } from "./researchProviders.js";
import { logger } from "./logger.js";

/** How far back news attention counts, and how long a reading is reused. */
const NEWS_WINDOW_HOURS = 48;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_BLOCKS = 25;

export interface NewsEventRow {
  clusterKey: string;
  headline: string;
  symbols: string[];
  firstSeen: Date;
}

/** Pure: recent news rows for one symbol → grounded NEWS blocks. */
export function blocksFromNewsRows(rows: NewsEventRow[], symbol: string): GroundedBlock[] {
  return rows
    .filter((r) => r.symbols.includes(symbol))
    .slice(0, MAX_BLOCKS)
    .map((r) => ({
      blockId: `news:${r.clusterKey}`,
      kind: "NEWS" as const,
      text: r.headline,
      publishedAt: r.firstSeen.toISOString(),
    }));
}

/** Pure: contract reading → the committee lens input shape. */
export function readingToLensInput(reading: SentimentReading): SentimentLensInput {
  return {
    band: reading.band,
    score: reading.score,
    confidence: reading.confidence,
    sources: reading.sources.map((s) => ({ kind: s.kind, itemCount: s.itemCount })),
    isEventProof: false,
  };
}

const cache = new Map<string, { at: number; value: SentimentLensInput | null }>();

/**
 * Best-effort grounded sentiment for one symbol. Returns null (never throws)
 * when no AI integration is configured or no recent news mentions the symbol.
 */
export async function getSentimentLensInput(symbol: string): Promise<SentimentLensInput | null> {
  const provider = getSentimentProvider();
  if (!provider) return null; // fully deterministic mode — skip the DB entirely

  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  let value: SentimentLensInput | null = null;
  try {
    const since = new Date(Date.now() - NEWS_WINDOW_HOURS * 3_600_000);
    // Symbol filter in SQL (jsonb containment): a newest-500 JS filter both
    // over-fetched and could starve a symbol whose news fell below the cutoff
    // on a busy day.
    const rows = await db
      .select({
        clusterKey: newsEventsTable.clusterKey,
        headline: newsEventsTable.headline,
        symbols: newsEventsTable.symbols,
        firstSeen: newsEventsTable.firstSeen,
      })
      .from(newsEventsTable)
      .where(and(gte(newsEventsTable.firstSeen, since), sql`${newsEventsTable.symbols} @> ${JSON.stringify([symbol])}::jsonb`))
      .orderBy(desc(newsEventsTable.firstSeen))
      .limit(50);

    const blocks = blocksFromNewsRows(rows, symbol);
    const reading = await readSentiment({
      readingId: `sent_${symbol}_${Date.now()}`,
      symbol,
      blocks,
      provider,
      now: new Date().toISOString(),
    });
    value = reading ? readingToLensInput(reading) : null;
  } catch (err) {
    logger.warn({ err: String(err), symbol }, "Sentiment context failed (non-fatal)");
    value = null;
  }

  cache.set(symbol, { at: Date.now(), value });
  return value;
}
