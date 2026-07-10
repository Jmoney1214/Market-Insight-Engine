import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeScoreboard, journalOutcomeToSample } from "@workspace/copilot-core";

type Row = { mode: string; manual_outcome: unknown };

/** Reproduce the production read path: journal rows -> TradeSamples (real
 * mapper) -> scoreboard. This is exactly what validationResolver +
 * retrieval-before-verdict consume. */
export function scoreboardFromRows(rows: Row[]) {
  const samples = rows
    .map((r) => journalOutcomeToSample({ mode: r.mode, manualOutcome: r.manual_outcome }))
    .filter((s): s is NonNullable<typeof s> => s !== null);
  return { samples, board: computeScoreboard(samples) };
}

/** What retrieval-before-verdict (spec §5) would fetch for a strategyId. */
export function retrieveForStrategy(board: ReturnType<typeof computeScoreboard>, strategyId: string) {
  const row = board.find((s) => s.hypothesisName === strategyId);
  return row
    ? { status: row.validationStatus, samples: row.countableSampleCount, expectancyR: row.expectancyR }
    : null;
}

if (import.meta.filename === process.argv[1]) {
  const path = resolve(import.meta.dirname, "../../../tools/research/backfill/journal-rows.json");
  const rows: Row[] = JSON.parse(readFileSync(path, "utf8"));
  const { samples, board } = scoreboardFromRows(rows);
  console.log(`\nTradeSamples produced from ${rows.length} journal rows: ${samples.length}`);
  const byStrat: Record<string, number> = {};
  for (const s of samples) byStrat[s.strategyName] = (byStrat[s.strategyName] ?? 0) + 1;
  console.log("  by strategy:", JSON.stringify(byStrat));
  console.log("\nSCOREBOARD (measured):");
  for (const s of board.filter((x) => x.countableSampleCount > 0)) {
    console.log(`  ${s.hypothesisName.padEnd(28)} ${s.validationStatus.padEnd(20)} ` +
      `n=${s.countableSampleCount} expR=${s.expectancyR}`);
  }
  console.log("\nRETRIEVAL-BEFORE-VERDICT would now retrieve:");
  for (const id of ["JUMPDAY_RIDER", "LARGECAP_SCALPER"]) {
    console.log(`  ${id}:`, JSON.stringify(retrieveForStrategy(board, id)));
  }
}
