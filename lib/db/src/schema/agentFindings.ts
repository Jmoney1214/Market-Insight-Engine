import { pgTable, serial, text, real, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Episodic memory of the research crew: each row is one agent's opinion about
 * a ticker/strategy at a moment in time. Findings are OPINIONS, never evidence
 * — a finding must NEVER become a journal/validation sample. The scoreboard
 * measures strategies from market outcomes only; findings are graded
 * separately into finding_grades to measure AGENT calibration.
 */
export const agentFindingsTable = pgTable("agent_findings", {
  id: serial("id").primaryKey(),
  agentName: text("agent_name").notNull(),
  ticker: text("ticker"), // nullable — some findings are market-wide
  strategyId: text("strategy_id"), // nullable — links a finding to a registry hypothesis (e.g. JUMPDAY_RIDER)
  verdict: text("verdict").notNull(), // 'support' | 'reject' | 'neutral' | 'unavailable'
  confidence: real("confidence").notNull(), // 0..1
  evidence: jsonb("evidence").notNull(), // string[]
  risks: jsonb("risks"), // string[]
  requiredFollowup: jsonb("required_followup"), // string[]
  eventTimestamp: timestamp("event_timestamp", { withTimezone: true }), // the session/moment the finding is about
  provenance: jsonb("provenance").notNull(), // { source, gitSha, configHash?, runRef? } — the audit stamp
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAgentFindingSchema = createInsertSchema(agentFindingsTable, {
  verdict: z.enum(["support", "reject", "neutral", "unavailable"]),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()),
  risks: z.array(z.string()).nullish(),
  requiredFollowup: z.array(z.string()).nullish(),
  provenance: z.object({
    source: z.string(),
    gitSha: z.string(),
    configHash: z.string().optional(),
    runRef: z.string().optional(),
  }),
}).omit({
  id: true,
  createdAt: true,
});
export type InsertAgentFinding = z.infer<typeof insertAgentFindingSchema>;
export type AgentFinding = typeof agentFindingsTable.$inferSelect;
