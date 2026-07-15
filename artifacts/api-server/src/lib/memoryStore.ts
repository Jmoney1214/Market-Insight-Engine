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
import { and, desc, eq, gte, inArray, isNotNull, notLike, or, sql } from "drizzle-orm";
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
 * Deterministic importance delta from whichever grade signal a row carries.
 * Two signals exist on the unified ledger: the ex-post outcome grader's score
 * (0..1) and the event-study verdict — the reinforcer accepts BOTH (keying
 * only on the outcome grader's columns left the loop dead for research rows,
 * which are graded via event_graded_at, never graded_at).
 */
export function reinforcementDelta(grade: { score: number | null; eventSignificant: boolean | null }): number | null {
  if (grade.score != null) return (grade.score * 100 - 50) / 5; // 0..1 scale, centered
  if (grade.eventSignificant != null) return grade.eventSignificant ? 10 : -8;
  return null;
}

/**
 * Wave 0 emergency containment: EPISODIC→SEMANTIC promotion is frozen until the
 * outcome/holdout promotion lab exists. Default OFF (frozen) — a low or
 * arbitrary grade reference must never mint permanent "trusted" truth. Thaws
 * only on the exact opt-in ENABLE_SEMANTIC_PROMOTION="true".
 */
export function semanticPromotionFrozen(): boolean {
  return process.env["ENABLE_SEMANTIC_PROMOTION"] !== "true";
}

/**
 * Pure per-row outcome of one reinforcement pass, and the SINGLE source of
 * truth for both effects:
 *   - importance is ALWAYS reinforced — never gated by the freeze (gating it
 *     would silently kill the Outcome Reinforcer for the episodic tier);
 *   - promote (the SEMANTIC layer flip) is the ONLY thing the freeze gates, and
 *     only for an eligible EPISODIC row.
 * `canPromoteAllowed` is the caller's precomputed canPromote() verdict.
 */
export function reinforcementDecision(input: {
  currentImportance: number;
  requestedDelta: number;
  layer: MemoryLayer;
  canPromoteAllowed: boolean;
  frozen: boolean;
}): { importance: number; promote: boolean } {
  return {
    importance: reinforceImportance(input.currentImportance, input.requestedDelta),
    promote: !input.frozen && input.layer === "EPISODIC" && input.canPromoteAllowed,
  };
}

/**
 * Outcome Reinforcer sweep: recent grades (outcome OR event-study) adjust the
 * importance of memories derived from those findings — bounded per event,
 * idempotent per grade ref, batched (one memory query per sweep, not per
 * grade). Promotion into SEMANTIC happens here and ONLY here, via canPromote.
 */
export async function reinforceFromGrades(lookbackHours = 48): Promise<number> {
  try {
    const since = new Date(Date.now() - lookbackHours * 3_600_000);
    const graded = await db
      .select({
        findingRef: findingGradesTable.findingRef,
        score: findingGradesTable.score,
        grade: findingGradesTable.grade,
        eventSignificant: findingGradesTable.eventSignificant,
        id: findingGradesTable.id,
      })
      .from(findingGradesTable)
      .where(
        and(
          or(gte(findingGradesTable.gradedAt, since), gte(findingGradesTable.eventGradedAt, since)),
          isNotNull(findingGradesTable.findingRef),
          // Brain hygiene: backtest-generated grades never reinforce live memory.
          notLike(findingGradesTable.runId, "backtest\\_%"),
        ),
      )
      .limit(200);
    if (graded.length === 0) return 0;

    const byRef = new Map(graded.filter((g) => g.findingRef).map((g) => [g.findingRef!, g]));
    const rows = await db
      .select()
      .from(memoryItemsTable)
      .where(inArray(memoryItemsTable.sourceRef, [...byRef.keys()]))
      .limit(500);

    // Freeze state is constant for the whole sweep — read once, not per row.
    const frozen = semanticPromotionFrozen();
    let adjusted = 0;
    for (const row of rows) {
      const g = row.sourceRef ? byRef.get(row.sourceRef) : undefined;
      if (!g) continue;
      const requestedDelta = reinforcementDelta(g);
      if (requestedDelta == null) continue;

      const log = (row.reinforcements as Array<{ gradeRef: string }>) ?? [];
      const gradeRef = `finding_grades:${g.id}`;
      if (log.some((entry) => entry.gradeRef === gradeRef)) continue; // idempotent

      // canPromote() is meaningful only for EPISODIC rows (the sole promotable
      // tier); compute it there and let reinforcementDecision own the freeze
      // gate. A grade is only actionable within the 48h reinforcement window,
      // so a promotion the freeze skips is NOT deferred for a later thaw — it is
      // forgone by design. That is acceptable: Wave 1+ rebuilds promotion from
      // the durable finding_grades ledger, not from these memory rows.
      const canPromoteAllowed =
        row.layer === "EPISODIC"
          ? canPromote({ ...rowToItem(row), independentGradeRef: gradeRef }, "SEMANTIC").allowed
          : false;
      const { importance, promote } = reinforcementDecision({
        currentImportance: row.importance,
        requestedDelta,
        layer: row.layer as MemoryLayer,
        canPromoteAllowed,
        frozen,
      });

      await db
        .update(memoryItemsTable)
        .set({
          importance,
          independentGradeRef: gradeRef,
          reinforcements: [
            ...log,
            {
              at: new Date().toISOString(),
              delta: importance - row.importance,
              reason: g.score != null ? `outcome grade ${g.grade ?? g.score}` : `event study ${g.eventSignificant ? "significant" : "insignificant"}`,
              gradeRef,
            },
          ],
          ...(promote
            ? { layer: "SEMANTIC" as const, promotedFrom: row.layer, promotedAt: new Date(), expiresAt: null }
            : {}),
        })
        .where(eq(memoryItemsTable.id, row.id));
      adjusted += 1;
    }
    if (adjusted > 0) logger.info({ adjusted }, "Memory reinforcement applied");
    return adjusted;
  } catch (err) {
    logger.warn({ err: String(err) }, "Reinforcement sweep failed (non-fatal)");
    return 0;
  }
}

/**
 * Wave 0 emergency containment: which research outcomes may enter episodic
 * memory at all. BLOCKED / failed runs carry no admitted research and are pure
 * noise — they must never accumulate as the desk's diary. (This is a floor, not
 * the quality gate; the deterministic tiered gate arrives in Wave 1.)
 */
export function episodeEligibleForMemory(researchOutcome: string): boolean {
  return researchOutcome === "COMPLETE" || researchOutcome === "PARTIAL";
}

/** Episodic memory of a completed research run — the desk's research diary. */
export async function recordResearchEpisode(result: LeadRunResult): Promise<void> {
  const packet = result.packet;
  if (!episodeEligibleForMemory(packet.researchOutcome)) {
    logger.info(
      { symbol: packet.symbol, outcome: packet.researchOutcome },
      "Research episode not memory-eligible (Wave 0 containment) — skipped",
    );
    return;
  }
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

/**
 * Wave 0 emergency containment gate for the COMMITTEE-facing decision-memory
 * feed. Suppressed by default — until Wave 1 gives episodes an explicit
 * trusted-only `retrieval_status`, "eligible-only" means an empty eligible set,
 * so no unvetted, possibly-fabricated verdict may reach the committee. Enforced
 * at the committee injection point (routes/copilot/explain.ts), NOT inside
 * getDecisionMemory — the read-only /memory/:symbol diagnostic must still show
 * the operator the real stored history. Re-enables only on ENABLE_DECISION_MEMORY="true".
 */
export function decisionMemoryEnabled(): boolean {
  return process.env["ENABLE_DECISION_MEMORY"] === "true";
}

/**
 * Decision memory: last N research verdicts on a ticker, outcome-joined.
 * Read-only and unfiltered by design — the operator diagnostic route relies on
 * it. Committee-facing suppression lives at the caller (see decisionMemoryEnabled).
 */
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
      .where(
        and(
          eq(researchPacketsTable.symbol, symbol),
          // Brain hygiene: backtest packets are hindsight-contaminated and
          // must never surface as the desk's live decision history.
          notLike(researchPacketsTable.runId, "backtest\\_%"),
        ),
      )
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
