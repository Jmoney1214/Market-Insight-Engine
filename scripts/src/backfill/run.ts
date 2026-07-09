import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { toStagedRow, type Candidate } from "./mapper.ts";
import { parseTradedRows } from "./parseReports.ts";
import { diffTradeSets } from "./diff.ts";

const ROOT = resolve(import.meta.dirname, "../../..");
const BF = resolve(ROOT, "tools/research/backfill");

// First backfill scope: the SINGLE-DATE reports only. Their summary tables map
// 1:1 to a session date, so the re-run is diffable and each trade's date is
// unambiguous. Multi-date range reports (2025-07, 2025-09, 2026-04, 2026-05)
// aggregate trades across a range without per-row dates — they defer to a
// follow-up that parses their per-date sections.
const SINGLE_DATES = ["2026-07-02", "2026-07-06", "2026-07-08"];

const all: Candidate[] = JSON.parse(readFileSync(resolve(BF, "candidates.json"), "utf8"));
const candidates = all.filter((c) => SINGLE_DATES.includes(c.date));

// Diff gate per date: re-run vs committed .md trade set on (symbol, date, entryHm).
let divergence = false;
for (const date of SINGLE_DATES) {
  const md = readFileSync(resolve(ROOT, `research/reports/${date}_${date}.md`), "utf8");
  const ref = parseTradedRows(md).map((t) => ({ symbol: t.symbol, date, entryHm: t.entryHm }));
  const rerun = candidates.filter((c) => c.date === date).map((c) => ({ symbol: c.symbol, date, entryHm: c.entryHm }));
  const d = diffTradeSets(rerun, ref);
  if (d.added.length || d.removed.length) {
    divergence = true;
    console.error(`\nDIFF-GATE HALT for ${date}:`);
    if (d.added.length) console.error(`  APPEARED (re-run, not .md): ${d.added.join(", ")}`);
    if (d.removed.length) console.error(`  VANISHED (.md, not re-run): ${d.removed.join(", ")}`);
    console.error(`  -> explain (gap-through fill / slippage) before staging. No rows written.`);
  } else {
    console.error(`diff ${date}: ${d.matched.length} matched, 0 divergence ✓`);
  }
}
if (divergence) { console.error("\nHalted on divergence — nothing staged."); process.exit(1); }

// Map + pre-validate; print the staging table.
const staged = candidates.map(toStagedRow);
const countable = staged.filter((r) => r.countable);
const dropped = staged.filter((r) => !r.countable);
const pad = (s: string, n: number) => String(s).padEnd(n);
console.log("\nSTAGING — replay backfill (tier: RESEARCH/backtest)\n");
console.log(pad("SYMBOL", 7) + pad("DATE", 12) + pad("STRATEGY", 16) + pad("R", 8) + pad("$P&L", 10) + pad("ACTION", 10) + "COUNTABLE");
for (const r of staged) {
  const mo = r.manualOutcome as Record<string, unknown>;
  console.log(
    pad(r.symbol, 7) + pad(r.dedupKey.split("|")[1], 12) +
    pad(String(mo.strategyName ?? "-"), 16) + pad(String(mo.rMultiple ?? "-"), 8) +
    pad(String(mo.pnlDollars ?? "-"), 10) + pad(String(mo.action ?? "-"), 10) +
    (r.countable ? "yes" : `NO (${r.dropReason})`));
}
console.log(`\n${countable.length} countable, ${dropped.length} dropped. Tier default = RESEARCH/backtest.`);
console.log("Multi-date reports (2025-07, 2025-09, 2026-04, 2026-05) deferred — need per-date section parsing.");
console.log("Review the rows above. Nothing is written until a human says 'write it'.");
writeFileSync(resolve(BF, "insert-plan.json"), JSON.stringify(countable, null, 2));
console.log(`\ninsert-plan.json written (${countable.length} rows) — the writer consumes this on explicit go.`);
