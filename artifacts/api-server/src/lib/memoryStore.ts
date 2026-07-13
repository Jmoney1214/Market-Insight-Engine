/**
 * Memory store wiring — Supabase persistence for the FinMem tiers, env-gated
 * OpenAI embeddings, bounded outcome reinforcement, and decision-memory
 * assembly from the research brain.
 *
 * Honesty rules carried through: no embeddings configured → similarity is
 * simply absent from ranking (never faked); promotion into SEMANTIC goes
 * through canPromote (schema validity + independent grade) — there is no
 * other write path into that layer; every failure here is non-fatal.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db, findingGradesTable, memoryItemsTable, researchPacketsTable } from "@workspace/db";
import {
  canPromote,
  cosineSimilarity,
  expiryFor,
  rankMemories,
  reinforceImportance,
  renderDecisionMemory,
  type DecisionMemoryEntry,
  type MemoryItem,
  type MemoryLayer,
  type RankedMemory,
} from "@workspace/research-agents";
import type { LeadRunResult } from "@workspace/research-agents";
import { logger } from "./logger.js";

const EMBEDDING_MODEL = "text-embedding-3-small";

function embeddingsConfigured(): boolean {
  return (
    !!process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"] && !!process.env["AI_INTEGRATIONS_OPENAI_API_KEY"]
  );
}

/** Embedding for one text, or null when unconfigured/failing (never faked). */
export async function getEmbedding(text: string): Promise<number[] | null> {
  if (!embeddingsConfigured()) return null;
  try {
    const { openai } = await import("@workspace/integrations-openai-ai-server");
    const res = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: text.slice(0, 8000) });
    const vec = res.data[0]?.embedding;
    return Array.isArray(vec) && vec.length > 0 ? vec : null;
  } catch (err) {
    logger.warn({ err: String(err) }, "Embedding unavailable (non-fatal)");
    return null;
  }
}

export interface RecordMemoryInput {
  layer: MemoryLayer;
  kind: string;
  symbol: string | null;
  content: string;
  importance?: number;
  sourceRunId?: string | null;
  sourceRef?: string | null;
  schemaValid?: boolean;
}

/** Appends one memory item (WORKING/EPISODIC/PERFORMANCE only — SEMANTIC is promotion-gated). */
export async function recordMemory(input: RecordMemoryInput): Promise<string | null> {
  if (input.layer === "SEMANTIC") {
    logger.warn({ kind: input.kind }, "Direct SEMANTIC write refused — promotion gate only");
    return null;
  }
  const memoryId = `mem_${randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();
  try {
    const embedding = await getEmbedding(input.content);
    await db.insert(memoryItemsTable).values({
      memoryId,
      layer: input.layer,
      kind: input.kind,
      symbol: input.symbol,
      content: input.content,
      importance: input.importance ?? 50,
      embedding,
      sourceRunId: input.sourceRunId ?? null,
      sourceRef: input.sourceRef ?? null,
      schemaValid: input.schemaValid ?? false,
      expiresAt: (() => {
        const e = expiryFor(input.layer, now);
        return e ? new Date(e) : null;
      })(),
    });
    return memoryId;
  } catch (err) {
    logger.warn({ err: String(err) }, "Memory write failed (non-fatal)");
    return null;
  }
}

type MemoryRow = typeof memoryItemsTable.$inferSelect;

function rowToItem(row: MemoryRow): MemoryItem {
  return {
    memoryId: row.memoryId,
    layer: row.layer as MemoryLayer,
    kind: row.kind,
    symbol: row.symbol,
    content: row.content,
    importance: row.importance,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    schemaValid: row.schemaValid,
    independentGradeRef: row.independentGradeRef,
  };
}

/**
 * FinMem retrieval: recent candidates for a symbol (plus symbol-less market
 * memories), similarity when both sides have embeddings, compound-ranked
 * under per-layer token budgets. Touches last_accessed_at on returned items.
 */
export async function retrieveMemories(input: {
  symbol: string;
  query: string;
  topK?: number;
}): Promise<RankedMemory[]> {
  try {
    const rows = await db
      .select()
      .from(memoryItemsTable)
      .where(sql`${memoryItemsTable.symbol} = ${input.symbol} OR ${memoryItemsTable.symbol} IS NULL`)
      .orderBy(desc(memoryItemsTable.createdAt))
      .limit(300);
    if (rows.length === 0) return [];

    const queryEmbedding = await getEmbedding(input.query);
    const similarities = new Map<string, number>();
    if (queryEmbedding) {
      for (const row of rows) {
        if (Array.isArray(row.embedding) && row.embedding.length > 0) {
          const sim = cosineSimilarity(queryEmbedding, row.embedding);
          if (sim != null) similarities.set(row.memoryId, sim);
        }
      }
    }

    const ranked = rankMemories({
      items: rows.map(rowToItem),
      now: new Date().toISOString(),
      similarities,
      topK: input.topK ?? 12,
    });

    if (ranked.length > 0) {
      await db
        .update(memoryItemsTable)
        .set({ lastAccessedAt: new Date() })
        .where(inArray(memoryItemsTable.memoryId, ranked.map((r) => r.item.memoryId)));
    }
    return ranked;
  } catch (err) {
    logger.warn({ err: String(err), symbol: input.symbol }, "Memory retrieval failed (non-fatal)");
    return [];
  }
}

/**
 * Outcome Reinforcer sweep: recent outcome grades adjust the importance of
 * memories derived from those findings — bounded per event, log appended.
 * Promotion into SEMANTIC happens here and ONLY here, via canPromote.
 */
export async function reinforceFromGrades(lookbackHours = 48): Promise<number> {
  try {
    const since = new Date(Date.now() - lookbackHours * 3_600_000);
    const graded = await db
      .select({
        findingRef: findingGradesTable.findingRef,
        score: findingGradesTable.score,
        grade: findingGradesTable.grade,
        gradedAt: findingGradesTable.gradedAt,
        id: findingGradesTable.id,
      })
      .from(findingGradesTable)
      .where(and(gte(findingGradesTable.gradedAt, since), sql`${findingGradesTable.findingRef} IS NOT NULL`))
      .limit(200);

    let adjusted = 0;
    for (const g of graded) {
      if (!g.findingRef || g.score == null) continue;
      const rows = await db
        .select()
        .from(memoryItemsTable)
        .where(eq(memoryItemsTable.sourceRef, g.findingRef))
        .limit(20);
      for (const row of rows) {
        const log = (row.reinforcements as Array<{ gradeRef: string }>) ?? [];
        const gradeRef = `finding_grades:${g.id}`;
        if (log.some((entry) => entry.gradeRef === gradeRef)) continue; // idempotent
        // Centered on 50: strong outcomes raise weight, weak ones lower it.
        const requestedDelta = (g.score - 50) / 5;
        const importance = reinforceImportance(row.importance, requestedDelta);

        const promotion = canPromote(
          { ...rowToItem(row), independentGradeRef: gradeRef },
          "SEMANTIC",
        );
        await db
          .update(memoryItemsTable)
          .set({
            importance,
            independentGradeRef: gradeRef,
            reinforcements: [
              ...log,
              { at: new Date().toISOString(), delta: importance - row.importance, reason: `outcome grade ${g.grade ?? g.score}`, gradeRef },
            ],
            ...(promotion.allowed && row.layer === "EPISODIC"
              ? { layer: "SEMANTIC" as const, promotedFrom: row.layer, promotedAt: new Date(), expiresAt: null }
              : {}),
          })
          .where(eq(memoryItemsTable.id, row.id));
        adjusted += 1;
      }
    }
    if (adjusted > 0) logger.info({ adjusted }, "Memory reinforcement applied");
    return adjusted;
  } catch (err) {
    logger.warn({ err: String(err) }, "Reinforcement sweep failed (non-fatal)");
    return 0;
  }
}

/** Episodic memory of a completed research run — the desk's research diary. */
export async function recordResearchEpisode(result: LeadRunResult): Promise<void> {
  const packet = result.packet;
  const catalyst = result.catalystRecords[0];
  const content = [
    `Research ${packet.researchMode} on ${packet.symbol}: ${packet.researchOutcome}.`,
    catalyst ? `Catalyst (${catalyst.eventType}, ${catalyst.verificationStatus}): ${catalyst.eventDescription}` : "No catalyst verified.",
    result.sentiment ? `Sentiment ${result.sentiment.band} (${result.sentiment.score.toFixed(2)}).` : null,
    result.conflicts.length > 0 ? `${result.conflicts.length} verifier conflict(s).` : null,
  ]
    .filter(Boolean)
    .join(" ");

  await recordMemory({
    layer: "EPISODIC",
    kind: "RESEARCH_EPISODE",
    symbol: packet.symbol,
    content,
    sourceRunId: packet.provenance.runId,
    sourceRef: catalyst?.catalystId ?? packet.packetId,
    schemaValid: true, // content derives from validated contracts
  });
}

/** Decision memory: last N research verdicts on a ticker, outcome-joined. */
export async function getDecisionMemory(symbol: string, limit = 5): Promise<string[]> {
  try {
    const packets = await db
      .select({
        packetId: researchPacketsTable.packetId,
        outcome: researchPacketsTable.researchOutcome,
        mode: researchPacketsTable.researchMode,
        createdAt: researchPacketsTable.createdAt,
      })
      .from(researchPacketsTable)
      .where(eq(researchPacketsTable.symbol, symbol))
      .orderBy(desc(researchPacketsTable.createdAt))
      .limit(limit);
    if (packets.length === 0) return [];

    const grades = await db
      .select({
        packetId: findingGradesTable.packetId,
        judgeMedianScore: findingGradesTable.judgeMedianScore,
        grade: findingGradesTable.grade,
      })
      .from(findingGradesTable)
      .where(inArray(findingGradesTable.packetId, packets.map((p) => p.packetId)))
      .limit(50);

    const entries: DecisionMemoryEntry[] = packets.map((p) => {
      const grade = grades.find((g) => g.packetId === p.packetId);
      const outcomeParts = [
        grade?.judgeMedianScore != null ? `judges ${grade.judgeMedianScore}` : null,
        grade?.grade ? `graded ${grade.grade}` : null,
      ].filter(Boolean);
      return {
        when: p.createdAt.toISOString(),
        source: `research ${p.mode}`,
        verdict: p.outcome,
        outcome: outcomeParts.length > 0 ? outcomeParts.join(", ") : null,
      };
    });
    return renderDecisionMemory(entries, limit);
  } catch (err) {
    logger.warn({ err: String(err), symbol }, "Decision memory unavailable (non-fatal)");
    return [];
  }
}
