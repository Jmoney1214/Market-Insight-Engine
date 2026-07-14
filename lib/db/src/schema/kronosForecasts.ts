import { pgTable, bigserial, text, integer, real, boolean, doublePrecision, jsonb, timestamp } from "drizzle-orm/pg-core";

/**
 * Kronos forecast ledger — models the PRE-EXISTING kronos_forecasts table
 * (the "waiting table": its shape is the contract the Mac-side forecaster
 * writes to). Wave 5 adds ONLY the grading columns; everything else matches
 * the live schema exactly. The Desk renders Kronos output ONLY while the
 * rolling calibration report passes — the gate lives in code
 * (@workspace/research-agents calibrationReport), not in a preference.
 */
export const kronosForecastsTable = pgTable("kronos_forecasts", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  runId: text("run_id").notNull(),
  modelVersion: text("model_version").notNull(),
  symbol: text("symbol").notNull(),
  anchorTs: timestamp("anchor_ts", { withTimezone: true }).notNull(),
  anchorPrice: doublePrecision("anchor_price").notNull(),
  session: text("session").notNull(), // PRE | RTH | POST
  barTimeframe: text("bar_timeframe").notNull(),
  horizonBars: integer("horizon_bars").notNull(),
  windowEndTs: timestamp("window_end_ts", { withTimezone: true }).notNull(),
  nSamples: integer("n_samples").notNull(),
  pUp: doublePrecision("p_up").notNull(),
  quantilePaths: jsonb("quantile_paths").notNull(),
  dispersionPct: doublePrecision("dispersion_pct"),
  qualityFlags: jsonb("quality_flags").notNull(),
  samplerParams: jsonb("sampler_params"),
  inputStartTs: timestamp("input_start_ts", { withTimezone: true }).notNull(),
  inputEndTs: timestamp("input_end_ts", { withTimezone: true }).notNull(),
  /** SHA-256 of the exact input bars — forecast provenance. */
  inputBarsHash: text("input_bars_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // --- calibration grading (Wave 5 additive columns) ---
  realizedPrice: real("realized_price"),
  realizedMovePct: real("realized_move_pct"),
  hit: boolean("hit"),
  brier: real("brier"),
  gradedAt: timestamp("graded_at", { withTimezone: true }),
});
