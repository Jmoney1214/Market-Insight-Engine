import { pgTable, serial, text, real, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { agentFindingsTable } from "./agentFindings";

/**
 * Grades findings against realized outcomes — the per-agent calibration
 * source (hit rate by verdict/confidence). This is the agent-level analogue
 * of strategy expectancy: strategies are scored by the journal/scoreboard,
 * agents are scored here.
 */
export const findingGradesTable = pgTable("finding_grades", {
  id: serial("id").primaryKey(),
  findingId: integer("finding_id")
    .notNull()
    .references(() => agentFindingsTable.id),
  grade: text("grade").notNull(), // 'correct' | 'incorrect' | 'mixed' | 'ungradable'
  realized: jsonb("realized"), // free-form notes on what the market actually did
  realizedOutcomeWindow: text("realized_outcome_window"), // e.g. "0940-1550" | "close"
  realizedMovePct: real("realized_move_pct"),
  followThrough: real("follow_through"), // move in the finding's implied direction
  adverseMove: real("adverse_move"), // max move against
  calibrationBucket: text("calibration_bucket"), // confidence bucket, e.g. "0.6-0.8"
  graderRef: text("grader_ref").notNull(), // which postflight run/report graded it
  graderVersion: text("grader_version").notNull().default("v1"), // rubric version — disentangles grader error from agent error
  score: real("score"), // 0..1 calibration contribution
  gradedAt: timestamp("graded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFindingGradeSchema = createInsertSchema(findingGradesTable, {
  grade: z.enum(["correct", "incorrect", "mixed", "ungradable"]),
  score: z.number().min(0).max(1).nullish(),
}).omit({
  id: true,
  gradedAt: true,
});
export type InsertFindingGrade = z.infer<typeof insertFindingGradeSchema>;
export type FindingGrade = typeof findingGradesTable.$inferSelect;
