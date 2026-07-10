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

/** Scan-scorecard picks + catch-rate for one trading day — the "did the predictor
 * call it" evidence for a session-level question. */
export async function sessionEvidence(db: ReadClient, date: string): Promise<EvidencePack> {
  const { data, error } = await db.from("scan_scorecard").select(
    "scan_date, symbol, list, score, gap_pct, price_at_scan, change_pct, range_pct, hit");
  if (error) throw new Error(`scan_scorecard read failed: ${String(error)}`);
  const picks = (data ?? []).filter((r) => r.scan_date === date);
  const facts: EvidenceFact[] = picks.map((p, i) => ({
    source: "pick",
    id: `${date}#${i}`,
    data: {
      symbol: p.symbol, list: p.list, gapPct: p.gap_pct, changePct: p.change_pct,
      rangePct: p.range_pct, hit: p.hit,
    },
  }));
  const hits = picks.filter((p) => p.hit === true).length;
  facts.push({ source: "catchRate", id: date, data: { picks: picks.length, hits } });
  return {
    subject: { kind: "session", date },
    facts,
    note: picks.length === 0 ? `no scorecard picks recorded for ${date}` : undefined,
  };
}

/** Recent history_log rows + an alert-level breakdown — the "why did a run break"
 * evidence. Postgres/API logs (management API via SUPABASE_ACCESS_TOKEN) are a
 * later add; their absence is reported, never fabricated. */
export async function systemEvidence(db: ReadClient, sinceHours: number): Promise<EvidencePack> {
  const { data, error } = await db.from("history_log").select(
    "id, event_id, symbol, mode, alert_level, created_at");
  if (error) throw new Error(`history_log read failed: ${String(error)}`);
  const rows = data ?? [];
  const facts: EvidenceFact[] = rows.slice(0, 50).map((r, i) => ({ source: "log", id: `log#${i}`, data: r }));
  const byAlertLevel: Record<string, number> = {};
  rows.forEach((r) => {
    const lvl = r.alert_level ?? "unknown";
    byAlertLevel[lvl] = (byAlertLevel[lvl] ?? 0) + 1;
  });
  facts.push({ source: "split", id: "byAlertLevel", data: byAlertLevel });
  return {
    subject: { kind: "system", sinceHours },
    facts,
    note: rows.length === 0
      ? "no history_log rows; Postgres/API logs need SUPABASE_ACCESS_TOKEN (not configured)"
      : undefined,
  };
}
