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
  promotedPrice?: number | null,
): { changePct: number; rangePct: number; hit: boolean } {
  const refClose = priceAtScan / (1 + gapPct / 100);
  const changePct = round(((bar.close - refClose) / refClose) * 100);
  const rangePct = round(((bar.high - bar.low) / bar.close) * 100);
  // LONG-ONLY (invert bearish to buy): the "fall" list is gap-down names taken
  // as inverted long dip-buys, so a hit is UPSIDE — never the old short-side.
  // A reclaim-PROMOTED fall row anchors to its actual promotion entry: for a
  // shallow gap the promotion line sits ABOVE the reference close, and grading
  // vs refClose would stamp HIT on a losing entry. Watch-only rows keep the
  // refClose anchor — they measure the raw-inversion counterfactual.
  const hit =
    list === "intraday"
      ? rangePct >= 2
      : list === "fall" && promotedPrice != null && promotedPrice > 0
        ? bar.close > promotedPrice
        : changePct > 0;
  return { changePct, rangePct, hit };
}

/**
 * Reclaim buffer: a fall-list name is promoted from watch-only to a real pick
 * only when its live price has reclaimed this % ABOVE its first-seen premarket
 * price — deterministic proof that buyers stepped in, not a knife mid-drop.
 * Measured basis: raw invert-to-buy graded 5/47 (11%) hits over the first three
 * recorded sessions while the jump list ran 80-93%.
 */
export const FALL_RECLAIM_BUFFER_PCT = 2;

/** Pure promotion predicate — unit-tested. */
export function fallReclaimReady(
  priceAtScan: number,
  currentPrice: number,
  bufferPct = FALL_RECLAIM_BUFFER_PCT,
): boolean {
  return priceAtScan > 0 && currentPrice >= priceAtScan * (1 + bufferPct / 100);
}

/** Record the morning's picks (idempotent — unique per day/symbol/list).
 * Fall-list rows are stamped WATCH-ONLY: they stay recorded and graded (the
 * learning loop keeps its data) but count as picks only after a reclaim
 * promotion. */
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
      watchOnly: list === "fall",
    }));
  });
  if (rows.length === 0) return;
  try {
    await db.insert(scanScorecardTable).values(rows).onConflictDoNothing();
  } catch (err) {
    logger.warn({ err: String(err) }, "Scorecard record failed (non-fatal)");
  }
}

/**
 * Promotion pass: called from the scan scheduler while the reclaim window is
 * open (record start through the engine's 11:00 entry-window end). Any of
 * today's watch-only fall rows whose live price has reclaimed the buffer above
 * its first-seen premarket price becomes a real pick, stamped with promotion
 * time and price. One-way and idempotent — a later fade never demotes it
 * (the grade will tell that story honestly).
 *
 * Prices are fetched HERE, for exactly the watching symbols — never from the
 * scan's ranked lists. A reclaiming name is structurally invisible to those at
 * the crossing: at +2% off a -1.5..-3.4% recorded gap its live gap sits inside
 * (-1.5, +1.5) — outside both gap lists — and the shrunken |gap| sinks its
 * prelim rank out of the finalists, so topIntraday can't be relied on either.
 */
export async function promoteFallReclaims(scanDate: string): Promise<number> {
  let watching: ScanScorecardRow[] = [];
  try {
    watching = await db
      .select()
      .from(scanScorecardTable)
      .where(
        and(
          eq(scanScorecardTable.scanDate, scanDate),
          eq(scanScorecardTable.list, "fall"),
          eq(scanScorecardTable.watchOnly, true),
        ),
      );
  } catch (err) {
    logger.warn({ err: String(err) }, "Fall watch read failed (non-fatal)");
    return 0;
  }
  if (watching.length === 0) return 0;
  const snaps = (await alpaca.getSnapshots(watching.map((r) => r.symbol))) ?? new Map();
  let promoted = 0;
  for (const row of watching) {
    const price = snaps.get(row.symbol)?.price;
    if (price == null || !fallReclaimReady(row.priceAtScan, price)) continue;
    try {
      await db
        .update(scanScorecardTable)
        .set({ watchOnly: false, promotedAt: new Date(), promotedPrice: price })
        .where(eq(scanScorecardTable.id, row.id));
      promoted++;
    } catch (err) {
      logger.warn({ err: String(err) }, "Fall promotion write failed (non-fatal)");
    }
  }
  if (promoted > 0) logger.info({ promoted, scanDate }, "Fall reclaims promoted to picks");
  return promoted;
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
    const g = gradeRow(row.list as ScanList, row.gapPct, row.priceAtScan, bar, row.promotedPrice);
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
    watchOnly: boolean;
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
  // Fall splits into promoted picks ("fall") vs watch-only ("fall-watch") so
  // the reclaim rule's edge is measured separately from the raw-breakdown tape
  // it replaced. Pre-reform fall rows have watchOnly=false and land in "fall" —
  // their 11%-hit history stays visible, not laundered.
  const stats = (list: string, sel: (r: ScanScorecardRow) => boolean) => {
    const graded = rows.filter((r) => sel(r) && r.hit !== null);
    const hits = graded.filter((r) => r.hit === true).length;
    return {
      list,
      graded: graded.length,
      hits,
      hitRate: graded.length > 0 ? round((hits / graded.length) * 100, 1) : 0,
    };
  };
  const lists = [
    stats("intraday", (r) => r.list === "intraday"),
    stats("jump", (r) => r.list === "jump"),
    stats("fall", (r) => r.list === "fall" && !r.watchOnly),
    stats("fall-watch", (r) => r.list === "fall" && r.watchOnly),
  ];
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
      watchOnly: r.watchOnly,
    })),
  };
}
