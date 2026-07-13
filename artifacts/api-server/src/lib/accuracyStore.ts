/**
 * Agent Accuracy Ranker wiring — assembles GradedFindingRow inputs from the
 * unified finding_grades ledger + persisted contract objects, then ranks with
 * the pure predict-then-top-k scorer. Accuracy only; no PnL enters here.
 *
 * Attribution: the research runner mints primary catalysts as cat_<run> and
 * contest re-verifications as cat_<run>_b — the deterministic id scheme IS
 * the agent attribution.
 */
import { and, eq, gte, inArray, isNotNull, like, notLike } from "drizzle-orm";
import { db, findingGradesTable, researchObjectsTable } from "@workspace/db";
import { rankAgents, type AgentAccuracy, type GradedFindingRow } from "@workspace/research-agents";
import { logger } from "./logger.js";

const ROLLING_DAYS = 30;

/** Run-id prefix that marks backtest-generated data (brain-hygiene rule). */
export const BACKTEST_RUN_PREFIX = "backtest_";

export function agentForCatalystId(catalystId: string): string {
  return catalystId.endsWith("_b") ? "second-verifier" : "catalyst-verifier";
}

export interface AccuracyOptions {
  /**
   * Data source: live metrics NEVER silently include backtest rows.
   * "live" (default) excludes backtest_* runs; "backtest" is backtest-only;
   * "all" mixes both and is labeled as such by the route.
   */
  source?: "live" | "backtest" | "all";
}

export async function computeAgentAccuracy(opts: AccuracyOptions = {}): Promise<AgentAccuracy[]> {
  const source = opts.source ?? "live";
  try {
    const since = new Date(Date.now() - ROLLING_DAYS * 86_400_000);
    const conditions = [
      eq(findingGradesTable.findingType, "CatalystRecord"),
      gte(findingGradesTable.judgedAt, since),
      isNotNull(findingGradesTable.findingRef),
    ];
    if (source === "live") conditions.push(notLike(findingGradesTable.runId, `${BACKTEST_RUN_PREFIX}%`));
    if (source === "backtest") conditions.push(like(findingGradesTable.runId, `${BACKTEST_RUN_PREFIX}%`));
    const graded = await db
      .select({
        findingRef: findingGradesTable.findingRef,
        judgeMedianScore: findingGradesTable.judgeMedianScore,
        eventSignificant: findingGradesTable.eventSignificant,
      })
      .from(findingGradesTable)
      .where(and(...conditions))
      .limit(2000);
    if (graded.length === 0) return [];

    const refs = graded.map((g) => g.findingRef!) ;

    const catalysts = await db
      .select({ objectId: researchObjectsTable.objectId, payload: researchObjectsTable.payload })
      .from(researchObjectsTable)
      .where(and(eq(researchObjectsTable.objectType, "CatalystRecord"), inArray(researchObjectsTable.objectId, refs)))
      .limit(2000);
    const statusById = new Map(
      catalysts.map((c) => [c.objectId, String((c.payload as { verificationStatus?: string }).verificationStatus ?? "UNKNOWN")]),
    );

    const audits = await db
      .select({ payload: researchObjectsTable.payload })
      .from(researchObjectsTable)
      .where(
        and(
          eq(researchObjectsTable.objectType, "SourceAudit"),
          inArray(researchObjectsTable.objectId, refs.map((r) => `audit_${r.replace(/^cat_/, "")}`)),
        ),
      )
      .limit(2000);
    const admittedByClaim = new Map(
      audits.map((a) => {
        const p = a.payload as { claimId?: string; validationStatus?: string };
        return [String(p.claimId ?? ""), p.validationStatus === "SUPPORTED"];
      }),
    );

    const byAgent = new Map<string, GradedFindingRow[]>();
    for (const g of graded) {
      const ref = g.findingRef!;
      const agent = agentForCatalystId(ref);
      const row: GradedFindingRow = {
        agent,
        verificationStatus: statusById.get(ref) ?? "UNKNOWN",
        judgeMedianScore: g.judgeMedianScore,
        eventSignificant: g.eventSignificant,
        claimAdmitted: admittedByClaim.has(`claim_${ref}`) ? admittedByClaim.get(`claim_${ref}`)! : null,
      };
      byAgent.set(agent, [...(byAgent.get(agent) ?? []), row]);
    }
    return rankAgents(byAgent);
  } catch (err) {
    logger.warn({ err: String(err) }, "Accuracy ranking failed (non-fatal)");
    return [];
  }
}
