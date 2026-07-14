/**
 * Kronos pipeline wiring — ingest from the Mac-side forecaster, calibration
 * grading after each forecast's window elapses, and THE HARD GATE: forecast
 * queries return Kronos output only while the rolling calibration report
 * passes. An uncalibrated or poorly calibrated model is invisible to the
 * Desk — the gate is code, not a preference.
 */
import { z } from "zod/v4";
import { and, desc, eq, gte, isNull, isNotNull, lt, notLike } from "drizzle-orm";
import { db, kronosForecastsTable } from "@workspace/db";
import {
  calibrationReport,
  gradeForecast,
  type CalibrationReport,
} from "@workspace/research-agents";
import * as alpaca from "./providers/alpaca.js";
import { logger } from "./logger.js";

/** Ingest contract — matches the waiting kronos_forecasts table exactly. */
export const KronosForecastIngest = z.strictObject({
  run_id: z.string().min(1),
  model_version: z.string().min(1),
  symbol: z.string().regex(/^[A-Z0-9.\-]{1,12}$/),
  anchor_ts: z.iso.datetime({ offset: true }),
  anchor_price: z.number().positive(),
  session: z.enum(["PRE", "RTH", "POST"]),
  bar_timeframe: z.string().min(1),
  horizon_bars: z.int().min(1),
  window_end_ts: z.iso.datetime({ offset: true }),
  n_samples: z.int().min(1),
  p_up: z.number().min(0).max(1),
  quantile_paths: z.record(z.string(), z.array(z.number())),
  dispersion_pct: z.number().nullable(),
  quality_flags: z.record(z.string(), z.unknown()),
  sampler_params: z.record(z.string(), z.unknown()).nullable(),
  input_start_ts: z.iso.datetime({ offset: true }),
  input_end_ts: z.iso.datetime({ offset: true }),
  input_bars_hash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type KronosForecastIngest = z.infer<typeof KronosForecastIngest>;

/**
 * Idempotent insert (dedupe on run/symbol/anchor/horizon); true ONLY when a
 * row was actually written — a conflict-skipped duplicate returns false so
 * the ingest response never claims to have stored what it silently dropped.
 */
export async function ingestForecast(input: KronosForecastIngest): Promise<boolean> {
  try {
    const inserted = await db
      .insert(kronosForecastsTable)
      .values({
        runId: input.run_id,
        modelVersion: input.model_version,
        symbol: input.symbol,
        anchorTs: new Date(input.anchor_ts),
        anchorPrice: input.anchor_price,
        session: input.session,
        barTimeframe: input.bar_timeframe,
        horizonBars: input.horizon_bars,
        windowEndTs: new Date(input.window_end_ts),
        nSamples: input.n_samples,
        pUp: input.p_up,
        quantilePaths: input.quantile_paths,
        dispersionPct: input.dispersion_pct,
        qualityFlags: input.quality_flags,
        samplerParams: input.sampler_params,
        inputStartTs: new Date(input.input_start_ts),
        inputEndTs: new Date(input.input_end_ts),
        inputBarsHash: input.input_bars_hash,
      })
      .onConflictDoNothing()
      .returning({ id: kronosForecastsTable.id });
    return inserted.length > 0;
  } catch (err) {
    logger.warn({ err: String(err), symbol: input.symbol }, "Kronos ingest failed");
    return false;
  }
}

/**
 * Calibrator sweep: grades forecasts whose window has closed, using the last
 * 5-minute bar AT OR BEFORE window end as the realized price — the forecast's
 * actual horizon. (Grading against the 4pm session close scored a 10:30
 * question with a 16:00 answer; every morning-pop-afternoon-fade day would
 * mark a correct call wrong.) Flat/unknown realizations stay ungraded
 * (retried next sweep) — never guessed.
 */
export async function gradeKronosForecasts(limit = 50): Promise<number> {
  try {
    const pending = await db
      .select()
      .from(kronosForecastsTable)
      .where(and(isNull(kronosForecastsTable.gradedAt), lt(kronosForecastsTable.windowEndTs, new Date(Date.now() - 3_600_000))))
      .limit(limit);
    if (pending.length === 0) return 0;

    let graded = 0;
    for (const row of pending) {
      const windowEndMs = row.windowEndTs.getTime();
      // 90-minute lookback absorbs thin premarket tape; the LAST bar <= window
      // end is the realized print for the forecast's own horizon.
      const bars = await alpaca.getIntradayBars5m(
        row.symbol,
        new Date(windowEndMs - 90 * 60_000).toISOString(),
        row.windowEndTs.toISOString(),
      );
      const last = bars?.filter((b) => b.t * 1000 <= windowEndMs).at(-1);
      if (!last || !Number.isFinite(last.c) || row.anchorPrice <= 0) continue;

      const realizedMovePct = ((last.c - row.anchorPrice) / row.anchorPrice) * 100;
      const grade = gradeForecast({ pUp: row.pUp, realizedMovePct });
      if (!grade) continue; // flat move — ungradable, stays pending

      await db
        .update(kronosForecastsTable)
        .set({
          realizedPrice: last.c,
          realizedMovePct,
          hit: grade.hit,
          brier: grade.brier,
          gradedAt: new Date(),
        })
        .where(eq(kronosForecastsTable.id, row.id));
      graded += 1;
    }
    if (graded > 0) {
      calibrationCache.clear(); // the report must reflect fresh grades immediately
      logger.info({ graded }, "Kronos forecasts graded");
    }
    return graded;
  } catch (err) {
    logger.warn({ err: String(err) }, "Kronos grading sweep failed (non-fatal)");
    return 0;
  }
}

const CALIBRATION_WINDOW_DAYS = 90;
const CALIBRATION_CACHE_TTL_MS = 60_000;
const calibrationCache = new Map<string, { at: number; report: CalibrationReport }>();

/**
 * Rolling calibration over graded forecasts (per model version). Cached for
 * 60s — grading only happens on the hourly after-close sweep, and the Desk
 * polls this on every forecast request. Walk-forward BACKFILL rows count
 * here by design: bars-only forecasts have no look-ahead, and earning the
 * gate from history is the backfill's whole purpose.
 */
export async function getCalibration(modelVersion?: string): Promise<CalibrationReport> {
  const cacheKey = modelVersion ?? "*";
  const hit = calibrationCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CALIBRATION_CACHE_TTL_MS) return hit.report;
  const since = new Date(Date.now() - CALIBRATION_WINDOW_DAYS * 86_400_000);
  const conditions = [isNotNull(kronosForecastsTable.gradedAt), gte(kronosForecastsTable.createdAt, since)];
  if (modelVersion) conditions.push(eq(kronosForecastsTable.modelVersion, modelVersion));
  const rows = await db
    .select({ pUp: kronosForecastsTable.pUp, hit: kronosForecastsTable.hit, brier: kronosForecastsTable.brier, realizedMovePct: kronosForecastsTable.realizedMovePct })
    .from(kronosForecastsTable)
    .where(and(...conditions))
    .limit(2000);

  const report = calibrationReport(
    rows
      .filter((r) => r.hit != null && r.brier != null && r.realizedMovePct != null)
      .map((r) => ({
        pUp: r.pUp,
        grade: { hit: r.hit!, brier: r.brier!, realizedUp: r.realizedMovePct! > 0 },
      })),
  );
  calibrationCache.set(cacheKey, { at: Date.now(), report });
  return report;
}

export interface GatedForecastResponse {
  symbol: string;
  calibration: CalibrationReport;
  /** Present ONLY when calibration.passed — the hard gate. */
  forecast: Record<string, unknown> | null;
  gated: boolean;
}

/** Latest forecast for a symbol, rendered ONLY behind a passing calibration. */
export async function getGatedForecast(symbol: string): Promise<GatedForecastResponse> {
  const calibration = await getCalibration();
  const base: GatedForecastResponse = { symbol, calibration, forecast: null, gated: !calibration.passed };
  if (!calibration.passed) return base;

  const rows = await db
    .select()
    .from(kronosForecastsTable)
    .where(
      and(
        eq(kronosForecastsTable.symbol, symbol),
        // Backfill rows calibrate the gate but are weeks-old anchors — the
        // Desk's "latest forecast" must always be a live-run forecast.
        notLike(kronosForecastsTable.runId, "backtest\\_%"),
      ),
    )
    .orderBy(desc(kronosForecastsTable.createdAt))
    .limit(1);
  const latest = rows[0];
  if (!latest) return base;

  return {
    ...base,
    forecast: {
      forecastRunId: latest.runId,
      modelVersion: latest.modelVersion,
      anchorTs: latest.anchorTs.toISOString(),
      anchorPrice: latest.anchorPrice,
      session: latest.session,
      barTimeframe: latest.barTimeframe,
      horizonBars: latest.horizonBars,
      windowEndTs: latest.windowEndTs.toISOString(),
      pUp: latest.pUp,
      quantilePaths: latest.quantilePaths,
      dispersionPct: latest.dispersionPct,
      nSamples: latest.nSamples,
      inputBarsHash: latest.inputBarsHash,
      createdAt: latest.createdAt.toISOString(),
    },
  };
}
