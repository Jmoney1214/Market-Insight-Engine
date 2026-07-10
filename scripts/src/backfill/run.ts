import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { toStagedRow, type Candidate } from "./mapper.js";
import { parseTradedRowsByDate } from "./parseReports.js";
import { diffTradeSets } from "./diff.js";

const ROOT = resolve(import.meta.dirname, "../../..");
const BF = resolve(ROOT, "tools/research/backfill");
const REPORTS = resolve(ROOT, "research/reports");

const candidates: Candidate[] = JSON.parse(readFileSync(resolve(BF, "candidates.json"), "utf8"));

// Reference set: section-aware parse of EVERY report -> (symbol, date, entryHm).
const ref = readdirSync(REPORTS)
  .filter((f) => f.endsWith(".md"))
  .flatMap((f) => parseTradedRowsByDate(readFileSync(resolve(REPORTS, f), "utf8"))
    .map((t) => ({ symbol: t.symbol, date: t.date, entryHm: t.entryHm })));

// Diff gate per date across all reports.
const dates = [...new Set(candidates.map((c) => c.date))].sort();
let divergence = false;
for (const date of dates) {
  const refD = ref.filter((r) => r.date === date);
  const rerunD = candidates.filter((c) => c.date === date).map((c) => ({ symbol: c.symbol, date, entryHm: c.entryHm }));
  const d = diffTradeSets(rerunD, refD);
  if (d.added.length || d.removed.length) {
    divergence = true;
    console.error(`\nDIFF-GATE for ${date}:`);
    if (d.added.length) console.error(`  APPEARED (re-run, not .md): ${d.added.join(", ")}`);
    if (d.removed.length) console.error(`  VANISHED (.md, not re-run): ${d.removed.join(", ")}`);
  } else {
    console.error(`diff ${date}: ${d.matched.length} matched, 0 divergence`);
  }
}
if (divergence) {
  console.error("\n⚠ Divergences above — the fixed engine (gap-through/EOD slippage) changed some");
  console.error("trades vs the stale reports. Review before writing; these are reportable, not noise.");
}

// Map + pre-validate; print the staging table.
const staged = candidates.map(toStagedRow);
const countable = staged.filter((r) => r.countable);
const pad = (s: unknown, n: number) => String(s).padEnd(n);
console.log("\nSTAGING — full replay backfill (tier: RESEARCH/backtest)\n");
console.log(pad("SYMBOL", 7) + pad("DATE", 12) + pad("STRATEGY", 16) + pad("R", 8) + pad("$P&L", 10) + pad("ACTION", 10) + "COUNTABLE");
for (const r of staged) {
  const mo = r.manualOutcome as Record<string, unknown>;
  console.log(pad(r.symbol, 7) + pad(r.dedupKey.split("|")[1], 12) + pad(mo.strategyName ?? "-", 16) +
    pad(mo.rMultiple ?? "-", 8) + pad(mo.pnlDollars ?? "-", 10) + pad(mo.action ?? "-", 10) +
    (r.countable ? "yes" : `NO (${r.dropReason})`));
}
const sumR = countable.reduce((s, r) => s + Number((r.manualOutcome as Record<string, unknown>).rMultiple ?? 0), 0);
console.log(`\n${countable.length} countable / ${staged.length} total. sumR=${sumR.toFixed(2)} exp=${(sumR / countable.length).toFixed(3)}R`);
console.log("Idempotent write skips the 15 rows already in the DB; only new rows insert.");
writeFileSync(resolve(BF, "insert-plan.json"), JSON.stringify(countable, null, 2));
console.log(`insert-plan.json written (${countable.length} rows).`);
