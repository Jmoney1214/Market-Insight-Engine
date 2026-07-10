import { pgTable, serial, text, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const journalEntriesTable = pgTable("journal_entries", {
  id: serial("id").primaryKey(),
  // Dedup key extracted from the journaled event. Idempotency: repeated submissions of the same
  // outcome (double-click / client retry) must not double-count into the edge scoreboard.
  eventId: text("event_id"),
  mode: text("mode").notNull(),
  symbol: text("symbol").notNull(),
  eventTimestamp: timestamp("event_timestamp", { withTimezone: true }),
  eventSnapshot: jsonb("event_snapshot"),
  manualOutcome: jsonb("manual_outcome"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // Nullable => entries with no event id are NOT deduped (Postgres treats NULLs as distinct).
  eventIdUq: uniqueIndex("journal_entries_event_id_uq").on(t.eventId),
}));

export const insertJournalEntrySchema = createInsertSchema(journalEntriesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertJournalEntry = z.infer<typeof insertJournalEntrySchema>;
export type JournalEntry = typeof journalEntriesTable.$inferSelect;
