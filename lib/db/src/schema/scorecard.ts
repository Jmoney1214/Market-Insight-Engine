import { pgTable, serial, text, real, timestamp, boolean, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Daily scan scorecard: each morning's picks are recorded once, then graded
 * after the close against the session's actual bar. This is what turns the
 * scanner's "predictor" claim into a measured hit rate.
 */
export const scanScorecardTable = pgTable(
  "scan_scorecard",
  {
    id: serial("id").primaryKey(),
    scanDate: text("scan_date").notNull(), // YYYY-MM-DD (America/New_York)
    symbol: text("symbol").notNull(),
    list: text("list").notNull(), // 'intraday' | 'jump' | 'fall'
    score: real("score").notNull(),
    gapPct: real("gap_pct").notNull(),
    priceAtScan: real("price_at_scan").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    // Outcome (filled by the after-close grader)
    sessionClose: real("session_close"),
    sessionHigh: real("session_high"),
    sessionLow: real("session_low"),
    changePct: real("change_pct"),
    rangePct: real("range_pct"),
    hit: boolean("hit"),
    gradedAt: timestamp("graded_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("scan_scorecard_day_symbol_list").on(t.scanDate, t.symbol, t.list)],
);

export type ScanScorecardRow = typeof scanScorecardTable.$inferSelect;
