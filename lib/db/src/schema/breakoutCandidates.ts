import { pgTable, bigint, text, real, boolean, timestamp, date, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Inbound queue: near-miss "Breakout Watch" candidates pushed by the quant-research engine for the
// committee to research. Discretionary watchlist, NOT a validated edge; verdicts land in agent_findings.
export const breakoutCandidatesTable = pgTable("breakout_candidates", {
  id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
  runDate: date("run_date").notNull(),
  ticker: text("ticker").notNull(),
  score: real("score"),
  grade: text("grade"),
  pathPct: real("path_pct"),
  spreadBp: real("spread_bp"),
  catalyst: boolean("catalyst").default(false),
  watchReason: text("watch_reason"),
  source: text("source").default("tradeability-nearmiss"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  runDateTickerKey: unique("breakout_candidates_run_date_ticker_key").on(t.runDate, t.ticker),
}));

// NB: `id` is generatedAlwaysAsIdentity, so drizzle-zod already excludes it from the insert
// schema — omitting it again throws "Unrecognized key" under zod v4. Only omit createdAt.
export const insertBreakoutCandidateSchema = createInsertSchema(breakoutCandidatesTable).omit({
  createdAt: true,
});
export type InsertBreakoutCandidate = z.infer<typeof insertBreakoutCandidateSchema>;
export type BreakoutCandidate = typeof breakoutCandidatesTable.$inferSelect;
