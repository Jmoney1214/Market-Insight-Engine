/**
 * News-event scanner (ContestTrade pattern) — deterministic, no LLM.
 *
 * Clusters market-wide headlines, preserves FIRST-SEEN times point-in-time,
 * and flags republications as stale so old stories can't masquerade as fresh
 * catalysts. Best-effort by rule: a failure here must never break the scan.
 */
import { createHash } from "node:crypto";
import { db, newsEventsTable } from "@workspace/db";
import { desc, gte } from "drizzle-orm";
import { logger } from "./logger.js";
import * as alpaca from "./providers/alpaca.js";
import type { MarketNewsItem } from "./providers/alpaca.js";

/** Normalized headline hash — the cluster identity across syndicated copies. */
export function clusterKey(headline: string): string {
  const normalized = headline
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(normalized).digest("hex").slice(0, 24);
}

export interface ClusteredNewsEvent {
  clusterKey: string;
  headline: string;
  symbols: string[];
  source: string;
  url: string | null;
  createdAt: string;
  /** True when this cluster was already known — a republication, not fresh news. */
  isRepeat: boolean;
  firstSeen: string;
}

/**
 * Pure clustering: dedupes items within the batch and against known clusters.
 * `known` maps clusterKey -> firstSeen ISO from prior recordings (PIT truth).
 */
export function clusterMarketNews(
  items: MarketNewsItem[],
  known: Map<string, string>,
  now: string,
): ClusteredNewsEvent[] {
  const seenInBatch = new Set<string>();
  const out: ClusteredNewsEvent[] = [];
  for (const item of items) {
    if (!item.headline) continue;
    const key = clusterKey(item.headline);
    if (seenInBatch.has(key)) continue; // syndicated copies in the same batch = one event
    seenInBatch.add(key);
    const priorFirstSeen = known.get(key);
    out.push({
      clusterKey: key,
      headline: item.headline,
      symbols: item.symbols.filter((s) => /^[A-Z]{1,5}$/.test(s)),
      source: item.source,
      url: item.url,
      createdAt: item.createdAt || now,
      isRepeat: priorFirstSeen !== undefined,
      firstSeen: priorFirstSeen ?? now,
    });
  }
  return out;
}

/** Look-back window for known clusters (repeat detection horizon). */
const KNOWN_WINDOW_DAYS = 14;

/**
 * Poll market news, cluster, and append NEW clusters to news_events.
 * Returns fresh (previously unseen) events; never throws.
 */
export async function recordNewsEvents(limit = 50): Promise<ClusteredNewsEvent[]> {
  try {
    const items = await alpaca.getMarketNews(limit);
    if (!items || items.length === 0) return [];
    const since = new Date(Date.now() - KNOWN_WINDOW_DAYS * 86_400_000);
    const knownRows = await db
      .select({ clusterKey: newsEventsTable.clusterKey, firstSeen: newsEventsTable.firstSeen })
      .from(newsEventsTable)
      .where(gte(newsEventsTable.firstSeen, since))
      .orderBy(desc(newsEventsTable.firstSeen))
      .limit(2000);
    const known = new Map(knownRows.map((r) => [r.clusterKey, r.firstSeen.toISOString()]));
    const clustered = clusterMarketNews(items, known, new Date().toISOString());
    const fresh = clustered.filter((c) => !c.isRepeat);
    if (fresh.length > 0) {
      await db
        .insert(newsEventsTable)
        .values(
          fresh.map((c) => ({
            clusterKey: c.clusterKey,
            headline: c.headline,
            symbols: c.symbols,
            source: c.source,
            url: c.url,
            publishedAt: c.createdAt ? new Date(c.createdAt) : new Date(),
          })),
        )
        .onConflictDoNothing();
      logger.info({ fresh: fresh.length, repeats: clustered.length - fresh.length }, "News events recorded");
    }
    return fresh;
  } catch (err) {
    logger.warn({ err: String(err) }, "News-event recording failed (non-fatal)");
    return [];
  }
}
