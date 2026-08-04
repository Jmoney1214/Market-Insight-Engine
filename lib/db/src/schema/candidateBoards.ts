import { date, doublePrecision, integer, pgSchema, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

/**
 * Type-only application model for the explicit-migration-owned FinDesk candidate-board ledger.
 * drizzle-kit push excludes both private tables; all constraints, RLS, grants, routines, and
 * immutability remain authoritative in 0002_immutable_pine_candidate_boards.sql.
 */
export const privateSchema = pgSchema("private");

export const candidateBoardsTable = privateSchema.table("candidate_boards", {
  schemaVersion: integer("schema_version").notNull(),
  sourceBoardId: uuid("source_board_id").primaryKey(),
  sourceProjectRef: text("source_project_ref").notNull(),
  sourceSystemVersion: text("source_system_version").notNull(),
  sourceRunId: text("source_run_id").notNull(),
  tradeDate: date("trade_date").notNull(),
  boardType: text("board_type").notNull(),
  stageScheduledAt: timestamp("stage_scheduled_at", { withTimezone: true }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  decisionCutoffAt: timestamp("decision_cutoff_at", { withTimezone: true }).notNull(),
  frozenAt: timestamp("frozen_at", { withTimezone: true }),
  status: text("status").notNull(),
  exceptionCode: text("exception_code"),
  parentBoardId: uuid("parent_board_id"),
  boardHash: text("board_hash"),
  candidateCount: integer("candidate_count").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const candidateBoardEntriesTable = privateSchema.table("candidate_board_entries", {
  sourceBoardId: uuid("source_board_id").notNull(),
  symbol: text("symbol").notNull(),
  sourceRank: integer("source_rank").notNull(),
  sourceScore: doublePrecision("source_score").notNull(),
  firstSeenBoardId: uuid("first_seen_board_id"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }),
  evidenceCutoffAt: timestamp("evidence_cutoff_at", { withTimezone: true }).notNull(),
  evidenceReferenceIds: text("evidence_reference_ids").array().notNull(),
  reasonCodes: text("reason_codes").array().notNull(),
  sourceReasonSummary: text("source_reason_summary").notNull(),
  entryHash: text("entry_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({
  sourceBoardSymbolKey: primaryKey({ columns: [table.sourceBoardId, table.symbol] }),
  sourceBoardRankKey: unique("candidate_board_entries_source_board_rank_key").on(table.sourceBoardId, table.sourceRank),
}));

export type CandidateBoard = typeof candidateBoardsTable.$inferSelect;
export type CandidateBoardEntry = typeof candidateBoardEntriesTable.$inferSelect;
