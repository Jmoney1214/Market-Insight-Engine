import { pgTable, serial, text, integer, real, jsonb, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Unified grade ledger — ONE row per finding's grading lifecycle.
 *
 * Ex-ante (judge panel, ContestTrade deduction-only): judge_median_score,
 * judge_count, judge_scores, judged_at — written when research is produced.
 * Ex-post (outcome grader): grade, score, realized*, calibration_bucket,
 * graded_at — written after the outcome window closes.
 *
 * Legacy brain rows (finding_type AGENT_FINDING) keep their integer FK in
 * finding_id; research-layer rows key by finding_ref (text contract id) and
 * leave finding_id null. External systems also write this table — schema
 * changes must stay additive, and it is excluded from drizzle-kit push
 * ownership in drizzle.config.ts.
 */
export const findingGradesTable = pgTable(
  "finding_grades",
  {
    id: serial("id").primaryKey(),
    /** Legacy FK to agent_findings(id); null for research-layer findings. */
    findingId: integer("finding_id"),
    findingType: text("finding_type"),
    /** Text finding id (e.g. catalystId); unified key across both worlds. */
    findingRef: text("finding_ref"),
    symbol: text("symbol"),
    runId: text("run_id"),
    packetId: text("packet_id"),
    // --- ex-ante judge panel ---
    judgeMedianScore: real("judge_median_score"),
    judgeCount: integer("judge_count"),
    judgeScores: jsonb("judge_scores"),
    judgedAt: timestamp("judged_at", { withTimezone: true }),
    // --- ex-post outcome grading (written by the after-close grader) ---
    grade: text("grade"),
    score: real("score"),
    realized: jsonb("realized"),
    graderRef: text("grader_ref"),
    graderVersion: text("grader_version"),
    calibrationBucket: text("calibration_bucket"),
    realizedOutcomeWindow: text("realized_outcome_window"),
    realizedMovePct: real("realized_move_pct"),
    followThrough: real("follow_through"),
    adverseMove: real("adverse_move"),
    gradedAt: timestamp("graded_at", { withTimezone: true }),
  },
  (t) => [
    index("finding_grades_ref_idx").on(t.findingType, t.findingRef),
    index("finding_grades_symbol_idx").on(t.symbol),
  ],
);
