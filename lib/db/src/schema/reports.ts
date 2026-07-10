import { pgTable, serial, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const reportsTable = pgTable("reports", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  companyName: text("company_name").notNull(),
  sector: text("sector").notNull(),
  industry: text("industry").notNull(),
  overallRating: text("overall_rating").notNull(),
  // Data provenance: 'live' (rating from real provider data), 'partial' (live keys present but the
  // rating fell back to placeholder), or 'mock' (no provider keys — whole report fabricated).
  // Consumers MUST NOT treat overallRating as a real signal unless source = 'live'.
  source: text("source").notNull().default("unknown"),
  reportData: jsonb("report_data").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertReportSchema = createInsertSchema(reportsTable).omit({ id: true, generatedAt: true });
export type InsertReport = z.infer<typeof insertReportSchema>;
export type Report = typeof reportsTable.$inferSelect;
