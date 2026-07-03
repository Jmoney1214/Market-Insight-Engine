import { pgTable, serial, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const historyLogTable = pgTable("history_log", {
  id: serial("id").primaryKey(),
  eventId: text("event_id"),
  symbol: text("symbol"),
  mode: text("mode").notNull(),
  alertLevel: text("alert_level"),
  eventSnapshot: jsonb("event_snapshot").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertHistoryLogSchema = createInsertSchema(historyLogTable).omit({
  id: true,
  createdAt: true,
});
export type InsertHistoryLog = z.infer<typeof insertHistoryLogSchema>;
export type HistoryLogRow = typeof historyLogTable.$inferSelect;
