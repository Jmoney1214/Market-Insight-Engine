import { pgTable, serial, text, integer, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Agent run ledger — one row per agent invocation. Provenance (agent version,
 * manifest hash, config hash, git SHA) makes every run reproducible; the
 * checkpoint column carries graph-shape-aware resume state (Wave 3).
 * Append-only apart from status/checkpoint/endedAt progression.
 */
export const agentRunsTable = pgTable("agent_runs", {
  id: serial("id").primaryKey(),
  runId: text("run_id").notNull().unique(),
  parentRunId: text("parent_run_id"),
  agentId: text("agent_id").notNull(),
  agentVersion: text("agent_version").notNull(),
  manifestHash: text("manifest_hash"),
  configHash: text("config_hash"),
  gitSha: text("git_sha"),
  status: text("status").notNull().default("running"), // running | completed | failed | resumed
  checkpoint: jsonb("checkpoint"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

/** Per-run tool-call audit (append-only): what each agent actually touched. */
export const agentToolCallsTable = pgTable(
  "agent_tool_calls",
  {
    id: serial("id").primaryKey(),
    runId: text("run_id").notNull(),
    seq: integer("seq").notNull(),
    toolName: text("tool_name").notNull(),
    args: jsonb("args"),
    result: jsonb("result"),
    status: text("status").notNull(), // ok | error | denied
    durationMs: integer("duration_ms").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("agent_tool_calls_run_seq_idx").on(t.runId, t.seq)],
);
