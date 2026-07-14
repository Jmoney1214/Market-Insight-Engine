import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

/**
 * Append-only audit of API calls attributed to a principal (agent token name
 * or 'anonymous' for the browser UIs). Never updated, never deleted.
 */
export const agentAuditTable = pgTable("agent_audit", {
  id: serial("id").primaryKey(),
  principal: text("principal").notNull(),
  method: text("method").notNull(),
  path: text("path").notNull(),
  status: integer("status").notNull(),
  durationMs: integer("duration_ms").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
