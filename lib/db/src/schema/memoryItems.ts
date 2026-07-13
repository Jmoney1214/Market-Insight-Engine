import { pgTable, serial, text, real, boolean, jsonb, timestamp, vector, index, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * FinMem tiered memory store — all four layers (WORKING / EPISODIC / SEMANTIC /
 * PERFORMANCE) in one append-mostly table, discriminated by `layer`; per-layer
 * expiry/decay/budgets live in @workspace/research-agents LAYER_POLICIES.
 *
 * Anti-poisoning gate: rows enter SEMANTIC only via a promotion that verifies
 * schema_valid AND independent_grade_ref (finding_grades) — never by an
 * agent's own write. Importance moves only through bounded reinforcement.
 */
export const memoryItemsTable = pgTable(
  "memory_items",
  {
    id: serial("id").primaryKey(),
    memoryId: text("memory_id").notNull(),
    layer: text("layer").notNull(), // WORKING | EPISODIC | SEMANTIC | PERFORMANCE
    kind: text("kind").notNull(),
    symbol: text("symbol"),
    content: text("content").notNull(),
    importance: real("importance").notNull().default(50),
    /** text-embedding-3-small; null when embeddings are unconfigured. */
    embedding: vector("embedding", { dimensions: 1536 }),
    sourceRunId: text("source_run_id"),
    /** e.g. packet/catalyst id this memory derives from. */
    sourceRef: text("source_ref"),
    schemaValid: boolean("schema_valid").notNull().default(false),
    independentGradeRef: text("independent_grade_ref"),
    promotedFrom: text("promoted_from"),
    promotedAt: timestamp("promoted_at", { withTimezone: true }),
    /** Bounded importance adjustments: [{at, delta, reason, gradeRef}]. */
    reinforcements: jsonb("reinforcements").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("memory_items_memory_idx").on(t.memoryId),
    index("memory_items_symbol_layer_idx").on(t.symbol, t.layer),
    index("memory_items_layer_idx").on(t.layer),
  ],
);
