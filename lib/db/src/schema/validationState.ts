import { pgTable, serial, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const validationStateTable = pgTable("validation_state", {
  id: serial("id").primaryKey(),
  strategyName: text("strategy_name").notNull().unique(),
  validationStatus: text("validation_status").notNull().default("unproven"),
  sampleCount: integer("sample_count").notNull().default(0),
  metrics: jsonb("metrics").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertValidationStateSchema = createInsertSchema(validationStateTable).omit({
  id: true,
  updatedAt: true,
});
export type InsertValidationState = z.infer<typeof insertValidationStateSchema>;
export type ValidationStateRow = typeof validationStateTable.$inferSelect;
