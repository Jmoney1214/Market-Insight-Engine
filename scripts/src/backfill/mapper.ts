// Relative import into copilot-core's TS source (dependency-free) so this runs
// under `npx tsx` without a workspace install — see the Task 0 deviation note.
import { journalOutcomeToSample } from "@workspace/copilot-core";

export type Candidate = {
  symbol: string; date: string; cls: string; entryHm: string;
  entry: number; exit: number; stop: number; pnl: number;
  rMultiple: number | null; reason: string;
  configHash: string; gitSha: string; reportRef: string;
};

export type StagedRow = {
  mode: "RESEARCH"; symbol: string; eventTimestampUtc: string; notes: string;
  manualOutcome: Record<string, unknown>; dedupKey: string;
  countable: boolean; dropReason: string | null;
};

const CLASS_TO_HYPOTHESIS: Record<string, string> = {
  rider: "JUMPDAY_RIDER",
  scalper: "LARGECAP_SCALPER",
};

export function actionFromReason(reason: string): "stop_hit" | "target_hit" | "closed" {
  if (reason === "stop") return "stop_hit";
  if (reason === "target") return "target_hit";
  return "closed"; // eod, data-end
}

export function timeWindowFromHm(hm: string): string {
  const [h, m] = hm.split(":").map(Number);
  const mins = h * 60 + m;
  if (mins < 600) return "open";        // 09:30-10:00
  if (mins < 660) return "morning";     // 10:00-11:00
  if (mins < 840) return "midday";      // 11:00-14:00
  if (mins < 900) return "afternoon";   // 14:00-15:00
  return "power_hour";                  // 15:00-16:00
}

function nthSunday(year: number, month1: number, n: number): number {
  const first = new Date(Date.UTC(year, month1 - 1, 1));
  const firstSundayDate = 1 + ((7 - first.getUTCDay()) % 7);
  return Date.UTC(year, month1 - 1, firstSundayDate + (n - 1) * 7) / 86400000;
}

/** ET session date + entry time -> a UTC ISO string. US DST 2007+: 2nd Sunday
 * March .. 1st Sunday November = EDT (-4), else EST (-5). Stored with the right
 * offset so the dedup compare is DST-safe. */
function etToUtcIso(dateISO: string, hm: string): string {
  const [y, mo, d] = dateISO.split("-").map(Number);
  const [h, mi] = hm.split(":").map(Number);
  const asDay = Date.UTC(y, mo - 1, d) / 86400000;
  const isEdt = asDay >= nthSunday(y, 3, 2) && asDay < nthSunday(y, 11, 1);
  const offset = isEdt ? 4 : 5;
  return new Date(Date.UTC(y, mo - 1, d, h + offset, mi)).toISOString();
}

export function toStagedRow(c: Candidate): StagedRow {
  const strategyName = CLASS_TO_HYPOTHESIS[c.cls];
  const dedupKey = `${c.symbol}|${c.date}|${strategyName ?? c.cls}|${c.entryHm}`;
  const base = {
    mode: "RESEARCH" as const,
    symbol: c.symbol,
    eventTimestampUtc: etToUtcIso(c.date, c.entryHm),
    notes: `${c.symbol} ${c.cls} ${c.entryHm} ${c.reason} (${c.pnl >= 0 ? "+" : ""}${c.pnl})`,
    dedupKey,
  };
  if (!strategyName) {
    return { ...base, manualOutcome: {}, countable: false,
      dropReason: `class "${c.cls}" is not a registered promotable hypothesis` };
  }
  const manualOutcome = {
    strategyName,
    outcomeConfidence: "MANUAL_CONFIRMED",
    rMultiple: c.rMultiple,
    pnlDollars: c.pnl,
    action: actionFromReason(c.reason),
    regime: null,
    timeWindow: timeWindowFromHm(c.entryHm),
    source: "replay_rerun",
    configHash: c.configHash,
    gitSha: c.gitSha,
    reportRef: c.reportRef,
  };
  // Prove countability through the REAL production mapper — never a silent drop.
  const sample = journalOutcomeToSample({ mode: "RESEARCH", manualOutcome });
  return { ...base, manualOutcome, countable: sample !== null,
    dropReason: sample === null ? "journalOutcomeToSample rejected the row" : null };
}
