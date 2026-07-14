import { pgTable, serial, text, integer, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Research brain — CandidatePackets and their content-addressed evidence.
 *
 * research_packets: one row per packet (the queryable spine); the full
 * contract rides along verbatim in `packet`.
 * research_objects: one row per referenced record (catalyst, claim, audit,
 * conflict, sentiment, macro, capital structure), keyed by canonical SHA-256 —
 * the same object referenced by two packets stores exactly once, and any
 * packet can be re-verified forever by walking its dependency manifest.
 * Both tables are append-only.
 */
export const researchPacketsTable = pgTable(
  "research_packets",
  {
    id: serial("id").primaryKey(),
    packetId: text("packet_id").notNull(),
    packetRevision: integer("packet_revision").notNull(),
    candidateId: text("candidate_id").notNull(),
    symbol: text("symbol").notNull(),
    researchMode: text("research_mode").notNull(), // FAST | STANDARD | DEEP
    researchOutcome: text("research_outcome").notNull(), // COMPLETE | PARTIAL | BLOCKED | ...
    runId: text("run_id").notNull(), // joins agent_runs.run_id
    checks: jsonb("checks").notNull(),
    manifestId: text("manifest_id").notNull(),
    manifestSha256: text("manifest_sha256").notNull(),
    canonicalSha256: text("canonical_sha256").notNull(),
    packet: jsonb("packet").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("research_packets_packet_idx").on(t.packetId),
    index("research_packets_symbol_idx").on(t.symbol),
  ],
);

export const researchObjectsTable = pgTable(
  "research_objects",
  {
    id: serial("id").primaryKey(),
    objectType: text("object_type").notNull(),
    objectId: text("object_id").notNull(),
    objectVersion: text("object_version").notNull(),
    canonicalSha256: text("canonical_sha256").notNull(),
    symbol: text("symbol").notNull(),
    runId: text("run_id").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("research_objects_sha_idx").on(t.canonicalSha256),
    index("research_objects_type_id_idx").on(t.objectType, t.objectId),
  ],
);
