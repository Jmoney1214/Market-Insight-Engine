// Targeted replay re-run: for every traded row in the committed .md reports,
// re-run the CURRENT deterministic engine on that symbol's session bars to get
// true entry->stop R + a provenance stamp. Cheaper than a full-universe re-scan
// and grades exactly the trades the reports claim. Emits candidates.json for the
// scripts/ orchestrator (which diffs + maps + stages). Alpaca keys required.
//
// tools/research is outside the workspace, so this stays plain Node; the mapper
// (needs copilot-core) lives in scripts/ and runs under tsx.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { requireCreds, alpacaBars, gitSha } from "../lib/data.mjs";
import { etWindow, etHm, daysBefore } from "../lib/dates.mjs";
import { runEngine } from "../lib/engine.mjs";

requireCreds();
const SHA = gitSha();
const CONFIG_HASH = "engine@" + SHA;

const reportsDir = fileURLToPath(new URL("../../../research/reports", import.meta.url));
// Minimal traded-row parse (drives the re-run + fetch). The authoritative parse
// for the diff gate lives in scripts/src/backfill/parseReports.ts.
const ARROW = "(?:->|\\u2192)";
const SIGN = "[+\\-\\u2212]?";
const ROW = new RegExp(
  `^\\|\\s*([A-Z]{1,6})\\s*\\|\\s*(rider|scalper|caution|avoid)\\s*\\|.*\\btraded\\b.*` +
  `\\|\\s*(\\d{2}:\\d{2})\\s*${ARROW}\\s*\\d{2}:\\d{2}\\s+(stop|target|eod|data-end)\\b`);

// Collect traded rows tagged with their source report file + session date.
const rows = [];
for (const file of readdirSync(reportsDir).filter((f) => f.endsWith(".md")).sort()) {
  const md = readFileSync(`${reportsDir}/${file}`, "utf8");
  for (const line of md.split("\n")) {
    const m = ROW.exec(line.trim());
    if (!m) continue;
    // Session date = the LAST date in the filename range (single-date reports repeat it).
    const dates = file.replace(".md", "").split("_");
    // We do not know the exact per-row date inside a multi-date report from the
    // summary table alone; multi-date reports list per-DATE sections. Fall back to
    // re-running each candidate date and matching entryHm (below).
    rows.push({ symbol: m[1], cls: m[2], entryHm: m[3], reason: m[4], reportRef: `research/reports/${file}`, dates });
  }
}
console.error(`parsed ${rows.length} traded rows from ${new Set(rows.map((r) => r.reportRef)).size} reports`);

// Expand each row to its candidate session dates (every trading date in the range).
function datesInRange(a, b) {
  const out = [];
  let d = a;
  while (d <= b) { out.push(d); d = addDay(d); }
  return out;
}
function addDay(iso) {
  const [y, m, dd] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd + 1));
  return t.toISOString().slice(0, 10);
}

// Group all (symbol, date) pairs we must fetch.
const pairs = new Map(); // date -> Set<symbol>
for (const r of rows) {
  const [a, b] = r.dates.length === 2 ? r.dates : [r.dates[0], r.dates[0]];
  for (const d of datesInRange(a, b)) {
    if (!pairs.has(d)) pairs.set(d, new Set());
    pairs.get(d).add(r.symbol);
  }
}

const candidates = [];
for (const [day, symSet] of [...pairs.entries()].sort()) {
  const syms = [...symSet];
  const daily = await alpacaBars(syms, "1Day", `${daysBefore(day, 15)}T00:00:00Z`, `${day}T23:59:59Z`, `bf_d_${day}`);
  const w = etWindow(day, "04:00", "20:00");
  const pm = await alpacaBars(syms, "5Min", w.start, w.end, `bf_pm_${day}`);
  for (const sym of syms) {
    const dbars = (daily.get(sym) ?? []).filter((b) => String(b.t).slice(0, 10) < day);
    if (dbars.length === 0) continue;
    const prevClose = dbars[dbars.length - 1].c;
    const dayBars = (pm.get(sym) ?? []).map((b) => ({ ...b, hm: etHm(b.t) }));
    if (dayBars.length === 0) continue;
    // Determine the class from any row for this symbol on a source report.
    const rowForSym = rows.find((r) => r.symbol === sym);
    const cls = rowForSym ? rowForSym.cls : "rider";
    const reportRef = rowForSym ? rowForSym.reportRef : null;
    const res = runEngine(cls, dayBars, prevClose);
    for (const t of res.trades) {
      candidates.push({
        symbol: sym, date: day, cls, entryHm: t.entryHm,
        entry: t.entry, exit: t.exit, stop: t.stop, pnl: t.pnl,
        rMultiple: t.rMultiple, reason: t.reason,
        configHash: CONFIG_HASH, gitSha: SHA, reportRef,
      });
    }
  }
  console.error(`${day}: ${syms.length} symbols -> ${candidates.filter((c) => c.date === day).length} re-run trades`);
}

writeFileSync(new URL("./candidates.json", import.meta.url), JSON.stringify(candidates, null, 2));
console.error(`wrote ${candidates.length} candidate trades -> tools/research/backfill/candidates.json`);
