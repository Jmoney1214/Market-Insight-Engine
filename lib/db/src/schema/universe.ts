import { pgTable, serial, text, real, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Daily universe snapshot: the screener constituents as of each trading
 * morning. Point-in-time backtests read this instead of "today's" screener,
 * eliminating survivorship bias for every date after the feature shipped.
 */
export const universeSnapshotTable = pgTable(
  "universe_snapshot",
  {
    id: serial("id").primaryKey(),
    snapDate: text("snap_date").notNull(), // YYYY-MM-DD (America/New_York)
    symbol: text("symbol").notNull(),
    companyName: text("company_name"),
    price: real("price"),
    avgVolume: real("avg_volume"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("universe_snapshot_day_symbol").on(t.snapDate, t.symbol)],
);

export type UniverseSnapshotRow = typeof universeSnapshotTable.$inferSelect;
