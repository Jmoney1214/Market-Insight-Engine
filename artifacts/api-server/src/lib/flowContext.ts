/**
 * Capital-flow scanner (ContestTrade pattern) — deterministic, no LLM.
 * Sector performance -> normalized flow scores + a market-tilt read.
 * Annotation-only by rule: flow context informs, it never gates.
 */
import { logger } from "./logger.js";
import * as fmp from "./providers/fmp.js";
import type { FmpSectorPerformance } from "./providers/fmp.js";

export interface FlowContext {
  asOf: string;
  /** Sector -> day change % (as reported). */
  sectors: Record<string, number>;
  /** Sector -> score in [-1, 1] normalized against the strongest mover. */
  scores: Record<string, number>;
  leaders: string[];
  laggards: string[];
  /** Breadth tilt: fraction of sectors positive, in [0, 1]. */
  breadth: number;
  tilt: "RISK_ON" | "RISK_OFF" | "MIXED";
}

export function computeFlowContext(rows: FmpSectorPerformance[], asOf: string): FlowContext | null {
  if (rows.length === 0) return null;
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.changesPct)), 0.0001);
  const sectors: Record<string, number> = {};
  const scores: Record<string, number> = {};
  for (const r of rows) {
    sectors[r.sector] = r.changesPct;
    scores[r.sector] = Math.round((r.changesPct / maxAbs) * 100) / 100;
  }
  const sorted = [...rows].sort((a, b) => b.changesPct - a.changesPct);
  const positive = rows.filter((r) => r.changesPct > 0).length;
  const breadth = Math.round((positive / rows.length) * 100) / 100;
  return {
    asOf,
    sectors,
    scores,
    leaders: sorted.slice(0, 3).map((r) => r.sector),
    laggards: sorted.slice(-3).map((r) => r.sector).reverse(),
    breadth,
    tilt: breadth >= 0.65 ? "RISK_ON" : breadth <= 0.35 ? "RISK_OFF" : "MIXED",
  };
}

let cached: { at: number; ctx: FlowContext } | null = null;
const TTL_MS = 5 * 60 * 1000;

/** Live flow context, cached 5 minutes. Null when the provider has nothing. */
export async function getFlowContext(): Promise<FlowContext | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.ctx;
  try {
    const rows = await fmp.getSectorPerformance();
    if (!rows) return null;
    const ctx = computeFlowContext(rows, new Date().toISOString());
    if (ctx) cached = { at: Date.now(), ctx };
    return ctx;
  } catch (err) {
    logger.warn({ err: String(err) }, "Flow context fetch failed (non-fatal)");
    return null;
  }
}
