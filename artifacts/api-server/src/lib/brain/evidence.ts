import { computeScoreboard, journalOutcomeToSample } from "@workspace/copilot-core";
import type { EvidenceFact, EvidencePack } from "./types.ts";
import type { ReadClient } from "./supabaseClient.ts";

/** Journal rows for a strategy -> scoreboard row + per-trade facts + regime/time
 * splits, each tagged with its source so the synthesizer can cite it. */
export async function strategyEvidence(db: ReadClient, strategyId: string): Promise<EvidencePack> {
  const { data, error } = await db
    .from("journal_entries")
    .select("mode, manual_outcome");
  if (error) throw new Error(`journal_entries read failed: ${String(error)}`);
  const rows = (data ?? []).filter((r) => r.manual_outcome?.strategyName === strategyId);

  const facts: EvidenceFact[] = [];
  const samples = rows
    .map((r) => journalOutcomeToSample({ mode: r.mode, manualOutcome: r.manual_outcome }))
    .filter((s): s is NonNullable<typeof s> => s !== null);
  const board = computeScoreboard(samples).find((s) => s.hypothesisName === strategyId);
  if (board) {
    facts.push({
      source: "scoreboard",
      id: strategyId,
      data: {
        status: board.validationStatus,
        sampleCount: board.countableSampleCount,
        expectancyR: board.expectancyR,
        profitFactor: board.profitFactor,
        winRate: board.winRate,
        worstTimeWindow: board.worstTimeWindow,
        worstRegime: board.worstRegime,
      },
    });
  }

  // group counts by timeWindow and exit-action for the "why" signal
  const byWindow: Record<string, number> = {};
  const byAction: Record<string, number> = {};
  rows.forEach((r, i) => {
    const mo = r.manual_outcome ?? {};
    byWindow[mo.timeWindow ?? "unknown"] = (byWindow[mo.timeWindow ?? "unknown"] ?? 0) + 1;
    byAction[mo.action ?? "unknown"] = (byAction[mo.action ?? "unknown"] ?? 0) + 1;
    facts.push({
      source: "trade",
      id: `${strategyId}#${i}`,
      data: {
        rMultiple: mo.rMultiple,
        action: mo.action,
        timeWindow: mo.timeWindow,
        regime: mo.regime,
        reportRef: mo.reportRef,
      },
    });
  });
  facts.push({ source: "split", id: `${strategyId}:byTimeWindow`, data: byWindow });
  facts.push({ source: "split", id: `${strategyId}:byExitAction`, data: byAction });

  return {
    subject: { kind: "strategy", id: strategyId },
    facts,
    note: rows.length === 0 ? `no journal samples for ${strategyId}` : undefined,
  };
}
