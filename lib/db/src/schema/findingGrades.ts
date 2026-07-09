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
  outcome: text("outcome").notNull(), // 'correct' | 'incorrect' | 'indeterminate'
  realized: jsonb("realized"), // what the market actually did: { movePct?, followThrough?, notes? }
  graderRef: text("grader_ref").notNull(), // which postflight run/report graded it
  score: real("score"), // 0..1 calibration contribution
  gradedAt: timestamp("graded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFindingGradeSchema = createInsertSchema(findingGradesTable, {
  outcome: z.enum(["correct", "incorrect", "indeterminate"]),
  score: z.number().min(0).max(1).nullish(),
}).omit({
  id: true,
  gradedAt: true,
});
export type InsertFindingGrade = z.infer<typeof insertFindingGradeSchema>;
export type FindingGrade = typeof findingGradesTable.$inferSelect;
