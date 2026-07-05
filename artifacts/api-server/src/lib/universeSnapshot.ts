/**
 * Daily universe snapshots — the survivorship-bias fix.
 *
 * The live scan records each morning's screener constituents once per trading
 * day; the offline backtester then replays past dates against the TRUE
 * as-of universe instead of "today's" list. All DB operations are non-fatal:
 * the scan must never fail because the database hiccuped.
 */
import { db, universeSnapshotTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

export type UniverseEntry = { symbol: string; companyName: string | null; price?: number | null; avgVolume?: number | null };

let lastRecordedDate: string | null = null;

/** Record today's universe once (idempotent; repeat calls same-day are no-ops). */
export async function recordUniverseSnapshot(entries: UniverseEntry[], snapDate: string): Promise<void> {
  if (lastRecordedDate === snapDate || entries.length === 0) return;
  try {
    await db
      .insert(universeSnapshotTable)
      .values(entries.map((e) => ({
        snapDate,
        symbol: e.symbol,
        companyName: e.companyName ?? null,
        price: e.price ?? null,
        avgVolume: e.avgVolume ?? null,
      })))
      .onConflictDoNothing();
    lastRecordedDate = snapDate;
    logger.info({ snapDate, count: entries.length }, "Universe snapshot recorded");
  } catch (err) {
    logger.warn({ err: String(err) }, "Universe snapshot write failed (non-fatal)");
  }
}

export async function getUniverseSnapshot(date: string): Promise<{ date: string; count: number; symbols: UniverseEntry[] } | null> {
  try {
    const rows = await db
      .select()
      .from(universeSnapshotTable)
      .where(eq(universeSnapshotTable.snapDate, date));
    if (rows.length === 0) return null;
    return {
      date,
      count: rows.length,
      symbols: rows.map((r) => ({ symbol: r.symbol, companyName: r.companyName, price: r.price, avgVolume: r.avgVolume })),
    };
  } catch (err) {
    logger.warn({ err: String(err) }, "Universe snapshot read failed");
    return null;
  }
}
