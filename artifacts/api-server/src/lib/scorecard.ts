/**
 * Daily scan scorecard — records each morning's picks, grades them after the
 * close against the session's actual bar, and reports measured hit rates.
 *
 * Hit definitions (deliberately simple and checkable):
 *  - intraday: the session ranged >= 2% (the pick delivered multiple-trade room)
 *  - jump:     the session closed above the pre-market reference close
 *  - fall:     the session closed below the pre-market reference close
 *
 * All DB work is best-effort: failures are logged, never thrown, so the scan
 * and scheduler keep running even if the database is unavailable.
 */
import { db, scanScorecardTable, type ScanScorecardRow } from "@workspace/db";
import { eq, isNull, desc, and, lte } from "drizzle-orm";
import { logger } from "./logger.js";
import * as alpaca from "./providers/alpaca.js";
import type { ScanResult } from "./scan.js";

export type ScanList = "intraday" | "jump" | "fall";

const round = (n: number, p = 2) => Math.round(n * 10 ** p) / 10 ** p;

/** Pure grading math — unit-tested. `gapPct`/`priceAtScan` reconstruct the pre-market reference close. */
export function gradeRow(
  list: ScanList,
  gapPct: number,
  priceAtScan: number,
  bar: { high: number; low: number; close: number },
): { changePct: number; rangePct: number; hit: boolean } {
  const refClose = priceAtScan / (1 + gapPct / 100);
  const changePct = round(((bar.close - refClose) / refClose) * 100);
  const rangePct = round(((bar.high - bar.low) / bar.close) * 100);
  // LONG-ONLY (invert bearish to buy): the "fall" list is gap-down names taken
  // as inverted long dip-buys, so a hit is UPSIDE (changePct > 0), same as the
  // jump list — never the old short-side changePct < 0.
  const hit = list === "intraday" ? rangePct >= 2 : changePct > 0;
  return { changePct, rangePct, hit };
}

/** Record the morning's picks (idempotent — unique per day/symbol/list). */
export async function recordScanPicks(result: ScanResult, scanDate: string): Promise<void> {
  const rows = (["intraday", "jump", "fall"] as const).flatMap((list) => {
    const picks = list === "intraday" ? result.topIntraday : list === "jump" ? result.likelyJump : result.likelyFall;
    return picks.map((c) => ({
      scanDate,
      symbol: c.symbol,
      list,
      score: c.score,
      gapPct: c.gapPct,
      priceAtScan: c.price,
    }));
  });
  if (rows.length === 0) return;
  try {
    await db.insert(scanScorecardTable).values(rows).onConflictDoNothing();
  } catch (err) {
    logger.warn({ err: String(err) }, "Scorecard record failed (non-fatal)");
  }
}

/** Grade all pending rows for sessions up to and including `maxDate`. */
export async function gradePending(maxDate: string): Promise<number> {
  let pending: ScanScorecardRow[] = [];
  try {
    pending = await db
      .select()
      .from(scanScorecardTable)
      .where(and(isNull(scanScorecardTable.gradedAt), lte(scanScorecardTable.scanDate, maxDate)))
      .limit(100);
  } catch (err) {
    logger.warn({ err: String(err) }, "Scorecard read failed (non-fatal)");
    return 0;
  }
  let graded = 0;
  for (const row of pending) {
    const bar = await alpaca.getSessionBar(row.symbol, row.scanDate);
    if (!bar) continue; // holiday/halt/no data yet — retry next pass
    const g = gradeRow(row.list as ScanList, row.gapPct, row.priceAtScan, bar);
    try {
      await db
        .update(scanScorecardTable)
        .set({
          sessionClose: bar.close,
          sessionHigh: bar.high,
          sessionLow: bar.low,
          changePct: g.changePct,
          rangePct: g.rangePct,
          hit: g.hit,
          gradedAt: new Date(),
        })
        .where(eq(scanScorecardTable.id, row.id));
      graded++;
    } catch (err) {
      logger.warn({ err: String(err) }, "Scorecard grade write failed (non-fatal)");
    }
  }
  if (graded > 0) logger.info({ graded }, "Scorecard graded");
  return graded;
}

export type ScorecardSummary = {
  asOf: string;
  lists: Array<{ list: string; graded: number; hits: number; hitRate: number }>;
  recent: Array<{
    scanDate: string;
    symbol: string;
    list: string;
    score: number;
    gapPct: number;
    priceAtScan: number;
    changePct: number | null;
    rangePct: number | null;
    hit: boolean | null;
  }>;
};

export async function getScorecard(): Promise<ScorecardSummary> {
  let rows: ScanScorecardRow[] = [];
  try {
    rows = await db
      .select()
      .from(scanScorecardTable)
      .orderBy(desc(scanScorecardTable.scanDate), desc(scanScorecardTable.score))
      .limit(400);
  } catch (err) {
    logger.warn({ err: String(err) }, "Scorecard read failed (non-fatal)");
  }
  const lists = (["intraday", "jump", "fall"] as const).map((list) => {
    const graded = rows.filter((r) => r.list === list && r.hit !== null);
    const hits = graded.filter((r) => r.hit === true).length;
    return {
      list,
      graded: graded.length,
      hits,
      hitRate: graded.length > 0 ? round((hits / graded.length) * 100, 1) : 0,
    };
  });
  return {
    asOf: new Date().toISOString(),
    lists,
    recent: rows.slice(0, 30).map((r) => ({
      scanDate: r.scanDate,
      symbol: r.symbol,
      list: r.list,
      score: r.score,
      gapPct: r.gapPct,
      priceAtScan: r.priceAtScan,
      changePct: r.changePct,
      rangePct: r.rangePct,
      hit: r.hit,
    })),
  };
}
