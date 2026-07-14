/**
 * Event-Study Grader sweep (ai-hedge-fund CAR engine) — grades every research
 * catalyst on the unified ledger once its event window has elapsed: market-
 * model abnormal returns vs a SIZE-MATCHED benchmark (IWM for small caps,
 * SPY for large — audit issue #33) with a t-test, landed as event_* columns
 * on the finding's grade row. "Did the catalyst move the stock beyond noise"
 * — measured, never eyeballed. Also fuels the Accuracy Ranker's
 * false-catalyst rate and Brier calibration.
 */
import { and, eq, isNull, isNotNull, sql } from "drizzle-orm";
import { db, findingGradesTable, researchObjectsTable } from "@workspace/db";
import { eventStudyFromCloses } from "@workspace/research-agents";
import { benchmarkFor, type BenchmarkSymbol } from "./benchmark.js";
import * as alpaca from "./providers/alpaca.js";
import { logger } from "./logger.js";

const EVENT_WINDOW_DAYS = 3;
/** Grade only once the full event window could have printed (~5 calendar days). */
const MIN_AGE_MS = 5 * 86_400_000;

interface CatalystPayload {
  symbol?: string;
  firstKnownTime?: string | null;
  publicationTime?: string | null;
}

type DatedCloses = Array<{ date: string; close: number }>;

/** Per-benchmark series, fetched at most once per batch/sweep. */
export type MarketSeries = Partial<Record<BenchmarkSymbol, DatedCloses | null>>;

async function seriesFor(benchmark: BenchmarkSymbol, markets: MarketSeries): Promise<DatedCloses | null> {
  if (!(benchmark in markets)) {
    markets[benchmark] = await alpaca.getDailyClosesDated(benchmark).catch(() => null);
  }
  return markets[benchmark] ?? null;
}

/** Catalyst event time from its persisted contract object; null when unknown. */
async function eventTimeOf(findingRef: string): Promise<string | null> {
  const objects = await db
    .select({ payload: researchObjectsTable.payload })
    .from(researchObjectsTable)
    .where(
      and(
        eq(researchObjectsTable.objectType, "CatalystRecord"),
        eq(researchObjectsTable.objectId, findingRef),
      ),
    )
    .limit(1);
  const payload = objects[0]?.payload as CatalystPayload | undefined;
  return payload?.firstKnownTime ?? payload?.publicationTime ?? null;
}

/**
 * Core: run the size-matched event study for one finding. Returns the
 * event_* column set (benchmark stamped into the payload) or null when the
 * study is not yet computable (window not printed / thin history / no data).
 */
async function computeEventColumns(
  findingRef: string,
  symbol: string,
  markets: MarketSeries,
): Promise<Record<string, unknown> | null> {
  const eventTime = await eventTimeOf(findingRef);
  if (!eventTime || Date.now() - new Date(eventTime).getTime() < MIN_AGE_MS) return null;

  const benchmark = await benchmarkFor(symbol);
  const market = await seriesFor(benchmark, markets);
  const stock = await alpaca.getDailyClosesDated(symbol);
  if (!market || !stock) return null;

  const result = eventStudyFromCloses({
    stock,
    market,
    eventDate: eventTime.slice(0, 10),
    eventDays: EVENT_WINDOW_DAYS,
  });
  if (!result) return null;

  return {
    eventCar: result.car,
    eventTStat: result.tStat,
    eventSignificant: result.significant,
    eventStudy: {
      alpha: result.alpha,
      beta: result.beta,
      estimationDays: result.estimationDays,
      eventDays: result.eventDays,
      abnormalReturns: result.abnormalReturns,
      benchmark,
    },
    eventGradedAt: new Date(),
  };
}

/**
 * Grades one specific finding immediately (backtest path — the event date is
 * historical, so the window has already printed). The grade row is UPSERTED:
 * a deterministic-only deployment has no judge row to update, and the event
 * study must never depend on an LLM judge having run first. Pass shared
 * `markets` series when grading in a batch — one fetch per benchmark serves all.
 */
export async function gradeEventStudyByRef(
  findingRef: string,
  opts: { symbol: string; runId: string; packetId: string | null; markets?: MarketSeries },
): Promise<boolean> {
  try {
    const eventColumns = await computeEventColumns(findingRef, opts.symbol, opts.markets ?? {});
    if (!eventColumns) return false;

    const rows = await db
      .select({ id: findingGradesTable.id })
      .from(findingGradesTable)
      .where(and(eq(findingGradesTable.findingRef, findingRef), isNull(findingGradesTable.eventGradedAt)))
      .limit(1);
    if (rows[0]) {
      await db.update(findingGradesTable).set(eventColumns).where(eq(findingGradesTable.id, rows[0].id));
    } else {
      await db.insert(findingGradesTable).values({
        findingType: "CatalystRecord",
        findingRef,
        symbol: opts.symbol,
        runId: opts.runId,
        packetId: opts.packetId,
        ...eventColumns,
      });
    }
    return true;
  } catch (err) {
    logger.warn({ err: String(err), findingRef }, "Direct event-study grade failed (non-fatal)");
    return false;
  }
}

/** Grades up to `limit` pending catalyst rows; returns how many were graded. */
export async function gradeEventStudies(limit = 20): Promise<number> {
  try {
    const pending = await db
      .select({
        id: findingGradesTable.id,
        findingRef: findingGradesTable.findingRef,
        symbol: findingGradesTable.symbol,
        judgedAt: findingGradesTable.judgedAt,
      })
      .from(findingGradesTable)
      .where(
        and(
          eq(findingGradesTable.findingType, "CatalystRecord"),
          isNull(findingGradesTable.eventGradedAt),
          sql`${findingGradesTable.judgedAt} < now() - interval '5 days'`,
        ),
      )
      .limit(limit);
    if (pending.length === 0) return 0;

    // One series fetch per benchmark serves every grade in the sweep.
    const markets: MarketSeries = {};

    let graded = 0;
    for (const row of pending) {
      if (!row.findingRef || !row.symbol) continue;
      try {
        const eventColumns = await computeEventColumns(row.findingRef, row.symbol, markets);
        if (!eventColumns) continue; // not printed / unestimable — retried on later sweeps
        await db.update(findingGradesTable).set(eventColumns).where(eq(findingGradesTable.id, row.id));
        graded += 1;
      } catch (err) {
        // One poisoned row must not abort the rest of the sweep; it stays
        // pending and is retried next time.
        logger.warn({ err: String(err), findingRef: row.findingRef }, "Event-study row failed (skipped)");
      }
    }
    if (graded > 0) logger.info({ graded }, "Event studies graded");
    return graded;
  } catch (err) {
    logger.warn({ err: String(err) }, "Event-study sweep failed (non-fatal)");
    return 0;
  }
}

/**
 * One-time migration sweep: re-grades rows whose stored event study used a
 * benchmark that today's size rule would NOT choose (e.g. the pre-#33 SPY
 * grades on microcaps). Rows already on the correct benchmark are untouched.
 */
export async function regradeEventStudies(limit = 200): Promise<{ checked: number; regraded: number }> {
  const graded = await db
    .select({
      id: findingGradesTable.id,
      findingRef: findingGradesTable.findingRef,
      symbol: findingGradesTable.symbol,
      eventStudy: findingGradesTable.eventStudy,
    })
    .from(findingGradesTable)
    .where(and(eq(findingGradesTable.findingType, "CatalystRecord"), isNotNull(findingGradesTable.eventGradedAt)))
    .limit(limit);

  const markets: MarketSeries = {};
  let regraded = 0;
  for (const row of graded) {
    if (!row.findingRef || !row.symbol) continue;
    try {
      const stored = (row.eventStudy as { benchmark?: string } | null)?.benchmark ?? "SPY";
      const wanted = await benchmarkFor(row.symbol);
      if (stored === wanted) continue;

      const eventColumns = await computeEventColumns(row.findingRef, row.symbol, markets);
      if (!eventColumns) continue;
      await db.update(findingGradesTable).set(eventColumns).where(eq(findingGradesTable.id, row.id));
      regraded += 1;
    } catch (err) {
      logger.warn({ err: String(err), findingRef: row.findingRef }, "Event-study regrade row failed (skipped)");
    }
  }
  if (regraded > 0) logger.info({ regraded }, "Event studies re-graded onto size-matched benchmarks");
  return { checked: graded.length, regraded };
}
