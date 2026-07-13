/**
 * FinMem tiered memory — pure logic (storage lives in Supabase, wired by the
 * api-server).
 *
 * Four layers with per-layer decay and expiry:
 *   WORKING     — current-session scratch, hours;
 *   EPISODIC    — per-run research episodes, weeks;
 *   SEMANTIC    — validated durable knowledge, permanent, GATED (see below);
 *   PERFORMANCE — measured outcomes/edge records, permanent.
 *
 * Retrieval uses FinMem's compound score: recency decay (per-layer half-life)
 * + importance + optional embedding similarity, top-k under per-layer token
 * budgets.
 *
 * ANTI-POISONING GATE (system rule): outcomes may adjust importance weights
 * (bounded), but NOTHING self-promotes into SEMANTIC — promotion requires
 * schema validity AND an independent grade reference. No self-evolving truth.
 */

export type MemoryLayer = "WORKING" | "EPISODIC" | "SEMANTIC" | "PERFORMANCE";

export interface LayerPolicy {
  /** Recency half-life in hours for the compound score. */
  halfLifeHours: number;
  /** Default time-to-live in hours; null = permanent. */
  ttlHours: number | null;
  /** Retrieval token budget for this layer per query. */
  tokenBudget: number;
}

export const LAYER_POLICIES: Record<MemoryLayer, LayerPolicy> = {
  WORKING: { halfLifeHours: 6, ttlHours: 24, tokenBudget: 400 },
  EPISODIC: { halfLifeHours: 24 * 14, ttlHours: 24 * 60, tokenBudget: 800 },
  SEMANTIC: { halfLifeHours: 24 * 90, ttlHours: null, tokenBudget: 600 },
  PERFORMANCE: { halfLifeHours: 24 * 30, ttlHours: null, tokenBudget: 400 },
};

/** Expiry timestamp for a new item, or null for permanent layers. */
export function expiryFor(layer: MemoryLayer, now: string): string | null {
  const ttl = LAYER_POLICIES[layer].ttlHours;
  return ttl == null ? null : new Date(new Date(now).getTime() + ttl * 3_600_000).toISOString();
}

export interface MemoryItem {
  memoryId: string;
  layer: MemoryLayer;
  kind: string;
  symbol: string | null;
  content: string;
  /** 0..100; starts at 50 unless the writer knows better. */
  importance: number;
  createdAt: string;
  expiresAt: string | null;
  schemaValid: boolean;
  /** Reference to an INDEPENDENT grade (finding_grades row) — promotion gate. */
  independentGradeRef: string | null;
}

/** ~4 chars/token heuristic, consistent with the manifest budget convention. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function cosineSimilarity(a: number[], b: number[]): number | null {
  if (a.length === 0 || a.length !== b.length) return null;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return null;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * FinMem compound score in [0,1]. Similarity is optional: without it the
 * weights renormalize over recency+importance (never fabricated as 0.5).
 */
export function compoundScore(input: {
  layer: MemoryLayer;
  ageHours: number;
  importance: number;
  similarity: number | null;
}): number {
  const recency = Math.exp((-Math.LN2 * Math.max(0, input.ageHours)) / LAYER_POLICIES[input.layer].halfLifeHours);
  const importance = Math.min(100, Math.max(0, input.importance)) / 100;
  if (input.similarity == null) {
    return 0.5 * recency + 0.5 * importance;
  }
  const similarity = Math.min(1, Math.max(-1, input.similarity));
  return 0.35 * recency + 0.3 * importance + 0.35 * Math.max(0, similarity);
}

export interface RankedMemory {
  item: MemoryItem;
  score: number;
  tokens: number;
}

/**
 * Top-k retrieval under per-layer token budgets. Expired items never rank.
 * Deterministic: ties break on newer createdAt, then memoryId.
 */
export function rankMemories(input: {
  items: MemoryItem[];
  now: string;
  similarities?: Map<string, number>;
  topK?: number;
}): RankedMemory[] {
  const nowMs = new Date(input.now).getTime();
  const scored: RankedMemory[] = input.items
    .filter((m) => m.expiresAt == null || new Date(m.expiresAt).getTime() > nowMs)
    .map((item) => ({
      item,
      score: compoundScore({
        layer: item.layer,
        ageHours: (nowMs - new Date(item.createdAt).getTime()) / 3_600_000,
        importance: item.importance,
        similarity: input.similarities?.get(item.memoryId) ?? null,
      }),
      tokens: estimateTokens(item.content),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.item.createdAt.localeCompare(a.item.createdAt) ||
        a.item.memoryId.localeCompare(b.item.memoryId),
    );

  const budgetLeft: Record<MemoryLayer, number> = {
    WORKING: LAYER_POLICIES.WORKING.tokenBudget,
    EPISODIC: LAYER_POLICIES.EPISODIC.tokenBudget,
    SEMANTIC: LAYER_POLICIES.SEMANTIC.tokenBudget,
    PERFORMANCE: LAYER_POLICIES.PERFORMANCE.tokenBudget,
  };
  const out: RankedMemory[] = [];
  const topK = input.topK ?? 12;
  for (const ranked of scored) {
    if (out.length >= topK) break;
    if (budgetLeft[ranked.item.layer] < ranked.tokens) continue;
    budgetLeft[ranked.item.layer] -= ranked.tokens;
    out.push(ranked);
  }
  return out;
}

/** Max importance movement from any single outcome event (bounded loop). */
export const MAX_REINFORCEMENT_DELTA = 15;

/**
 * Outcome Reinforcer: adjusts importance from a graded outcome, BOUNDED.
 * Outcomes tune retrieval weight; they never rewrite content or layer.
 */
export function reinforceImportance(current: number, requestedDelta: number): number {
  const delta = Math.max(-MAX_REINFORCEMENT_DELTA, Math.min(MAX_REINFORCEMENT_DELTA, requestedDelta));
  return Math.min(100, Math.max(0, current + delta));
}

export interface PromotionDecision {
  allowed: boolean;
  reasons: string[];
}

/**
 * The anti-poisoning gate. Promotion into SEMANTIC (trusted, permanent)
 * requires BOTH schema validity and an independent grade reference — an
 * agent's own conviction can never mint durable truth.
 */
export function canPromote(item: MemoryItem, target: MemoryLayer): PromotionDecision {
  const reasons: string[] = [];
  if (item.layer === target) reasons.push("item is already in the target layer");
  if (target === "WORKING") reasons.push("demotion into WORKING is not a promotion");
  if (target === "SEMANTIC") {
    if (!item.schemaValid) reasons.push("SEMANTIC requires schema-validated content");
    if (!item.independentGradeRef) {
      reasons.push("SEMANTIC requires an independent grade reference (no self-evolving truth)");
    }
  }
  return { allowed: reasons.length === 0, reasons };
}

// ---- Decision Memory (DeepFund) ---------------------------------------------

export interface DecisionMemoryEntry {
  when: string;
  source: string;
  verdict: string;
  outcome: string | null;
}

/**
 * Renders the last N verdicts on a ticker as compact, deterministic lines for
 * the committee's memory lens. Pure formatting — never invents outcomes:
 * ungraded entries render "outcome pending".
 */
export function renderDecisionMemory(entries: DecisionMemoryEntry[], limit = 5): string[] {
  return entries
    .slice()
    .sort((a, b) => b.when.localeCompare(a.when))
    .slice(0, limit)
    .map(
      (e) =>
        `${e.when.slice(0, 10)} ${e.source}: ${e.verdict}` +
        (e.outcome ? ` → ${e.outcome}` : " → outcome pending"),
    );
}
