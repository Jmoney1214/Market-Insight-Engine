import { pgTable, serial, text, integer, real, jsonb, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Judge-panel grades (ContestTrade deduction-only scoring; distinct from the brain's outcome-grading finding_grades table) — one row per
 * graded finding. Scores start at 100 and only deductions with rubric-coded
 * reasons subtract; median across judges. Append-only.
 */
export const judgeGradesTable = pgTable(
  "judge_grades",
  {
    id: serial("id").primaryKey(),
    findingType: text("finding_type").notNull(),
    findingId: text("finding_id").notNull(),
    symbol: text("symbol").notNull(),
    runId: text("run_id").notNull(),
    packetId: text("packet_id"),
    medianScore: real("median_score").notNull(),
    judgeCount: integer("judge_count").notNull(),
    /** Per-judge scores with their rubric-coded deductions and reasons. */
    scores: jsonb("scores").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("judge_grades_finding_idx").on(t.findingType, t.findingId),
    index("judge_grades_symbol_idx").on(t.symbol),
  ],
);
