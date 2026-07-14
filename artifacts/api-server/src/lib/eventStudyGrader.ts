/**
 * Event-Study Grader sweep (ai-hedge-fund CAR engine) — grades every research
 * catalyst on the unified ledger once its event window has elapsed: market-
 * model abnormal returns vs SPY with a t-test, landed as event_* columns on
 * the finding's grade row. "Did the catalyst move the stock beyond noise" —
 * measured, never eyeballed. Also fuels the Accuracy Ranker's false-catalyst
 * rate and Brier calibration.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, findingGradesTable, researchObjectsTable } from "@workspace/db";
import { eventStudyFromCloses } from "@workspace/research-agents";
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

/**
 * Grades one specific finding immediately (backtest path — the event date is
 * historical, so the window has already printed). The grade row is UPSERTED:
 * a deterministic-only deployment has no judge row to update, and the event
 * study must never depend on an LLM judge having run first. Pass a shared
 * `market` (SPY) series when grading in a batch — one fetch serves all.
 */
export async function gradeEventStudyByRef(
  findingRef: string,
  opts: { symbol: string; runId: string; packetId: string | null; market?: DatedCloses | null },
): Promise<boolean> {
  try {
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
    const eventTime = payload?.firstKnownTime ?? payload?.publicationTime;
    if (!eventTime || Date.now() - new Date(eventTime).getTime() < MIN_AGE_MS) return false;

    const market = opts.market ?? (await alpaca.getDailyClosesDated("SPY"));
    const stock = await alpaca.getDailyClosesDated(opts.symbol);
    if (!market || !stock) return false;

    const result = eventStudyFromCloses({ stock, market, eventDate: eventTime.slice(0, 10), eventDays: EVENT_WINDOW_DAYS });
    if (!result) return false;

    const eventColumns = {
      eventCar: result.car,
      eventTStat: result.tStat,
      eventSignificant: result.significant,
      eventStudy: {
        alpha: result.alpha,
        beta: result.beta,
        estimationDays: result.estimationDays,
        eventDays: result.eventDays,
        abnormalReturns: result.abnormalReturns,
        benchmark: "SPY",
      },
      eventGradedAt: new Date(),
    };

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

    // One SPY series serves every grade in the sweep.
    const market = await alpaca.getDailyClosesDated("SPY");
    if (!market) return 0;

    let graded = 0;
    for (const row of pending) {
      if (!row.findingRef || !row.symbol) continue;

      // The catalyst's event date comes from its persisted contract object.
      const objects = await db
        .select({ payload: researchObjectsTable.payload })
        .from(researchObjectsTable)
        .where(
          and(
            eq(researchObjectsTable.objectType, "CatalystRecord"),
            eq(researchObjectsTable.objectId, row.findingRef),
          ),
        )
        .limit(1);
      const payload = objects[0]?.payload as CatalystPayload | undefined;
      const eventTime = payload?.firstKnownTime ?? payload?.publicationTime;
      if (!eventTime) continue;
      if (Date.now() - new Date(eventTime).getTime() < MIN_AGE_MS) continue;

      const stock = await alpaca.getDailyClosesDated(row.symbol);
      if (!stock) continue;

      const result = eventStudyFromCloses({
        stock,
        market,
        eventDate: eventTime.slice(0, 10),
        eventDays: EVENT_WINDOW_DAYS,
      });
      if (!result) continue; // unestimable (thin history) — retried on later sweeps

      await db
        .update(findingGradesTable)
        .set({
          eventCar: result.car,
          eventTStat: result.tStat,
          eventSignificant: result.significant,
          eventStudy: {
            alpha: result.alpha,
            beta: result.beta,
            estimationDays: result.estimationDays,
            eventDays: result.eventDays,
            abnormalReturns: result.abnormalReturns,
            benchmark: "SPY",
          },
          eventGradedAt: new Date(),
        })
        .where(eq(findingGradesTable.id, row.id));
      graded += 1;
    }
    if (graded > 0) logger.info({ graded }, "Event studies graded");
    return graded;
  } catch (err) {
    logger.warn({ err: String(err) }, "Event-study sweep failed (non-fatal)");
    return 0;
  }
}
