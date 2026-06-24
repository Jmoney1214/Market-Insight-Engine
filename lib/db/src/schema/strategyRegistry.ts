import { pgTable, serial, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const strategyRegistryTable = pgTable("strategy_registry", {
  id: serial("id").primaryKey(),
  hypothesisName: text("hypothesis_name").notNull().unique(),
  primaryEdgeType: text("primary_edge_type").notNull(),
  universe: text("universe"),
  holdingPeriod: text("holding_period"),
  minimumSampleCount: integer("minimum_sample_count").notNull().default(0),
  validationStatus: text("validation_status").notNull().default("unproven"),
  definition: jsonb("definition").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertStrategyRegistrySchema = createInsertSchema(strategyRegistryTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertStrategyRegistry = z.infer<typeof insertStrategyRegistrySchema>;
export type StrategyRegistry = typeof strategyRegistryTable.$inferSelect;
