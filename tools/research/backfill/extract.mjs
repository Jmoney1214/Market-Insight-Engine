// Targeted replay re-run: for every traded row in the committed .md reports,
// re-run the CURRENT deterministic engine on that symbol's session bars to get
// true entry->stop R + a provenance stamp. Section-aware: attributes each trade
// to the `## YYYY-MM-DD` section it falls under, so single-date AND multi-date
// range reports are handled uniformly. Emits candidates.json for the scripts/
// orchestrator (which diffs + maps + stages). Alpaca keys required.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { requireCreds, alpacaBars, gitSha } from "../lib/data.mjs";
import { etWindow, etHm, daysBefore } from "../lib/dates.mjs";
import { runEngine } from "../lib/engine.mjs";

requireCreds();
const SHA = gitSha();
const CONFIG_HASH = "engine@" + SHA;

const reportsDir = fileURLToPath(new URL("../../../research/reports", import.meta.url));
const ARROW = "(?:->|\\u2192)";
const ROW = new RegExp(
  `^\\|\\s*([A-Z]{1,6})\\s*\\|\\s*(rider|scalper|caution|avoid)\\s*\\|.*\\btraded\\b.*` +
  `\\|\\s*(\\d{2}:\\d{2})\\s*${ARROW}\\s*\\d{2}:\\d{2}\\s+(stop|target|eod|data-end)\\b`);
const DATE_HEADER = /^##\s+(\d{4}-\d{2}-\d{2})\s*$/;

// Section-aware parse: attribute each traded row to its `## date`.
const rows = []; // { symbol, cls, entryHm, reason, date, reportRef }
for (const file of readdirSync(reportsDir).filter((f) => f.endsWith(".md")).sort()) {
  const reportRef = `research/reports/${file}`;
  let date = null;
  for (const raw of readFileSync(`${reportsDir}/${file}`, "utf8").split("\n")) {
    const line = raw.trim();
    const h = DATE_HEADER.exec(line);
    if (h) { date = h[1]; continue; }
    const m = ROW.exec(line);
    if (!m || !date) continue;
    rows.push({ symbol: m[1], cls: m[2], entryHm: m[3], reason: m[4], date, reportRef });
  }
}
console.error(`parsed ${rows.length} dated traded rows from ${new Set(rows.map((r) => r.reportRef)).size} reports`);

// Group by exact date; each (symbol) re-runs on its own session.
const byDate = new Map(); // date -> rows[]
for (const r of rows) {
  if (!byDate.has(r.date)) byDate.set(r.date, []);
  byDate.get(r.date).push(r);
}

const candidates = [];
for (const [day, dayRows] of [...byDate.entries()].sort()) {
  const syms = [...new Set(dayRows.map((r) => r.symbol))];
  const daily = await alpacaBars(syms, "1Day", `${daysBefore(day, 15)}T00:00:00Z`, `${day}T23:59:59Z`, `bf_d_${day}`);
  const w = etWindow(day, "04:00", "20:00");
  const pm = await alpacaBars(syms, "5Min", w.start, w.end, `bf_pm_${day}`);
  for (const r of dayRows) {
    const sym = r.symbol;
    const dbars = (daily.get(sym) ?? []).filter((b) => String(b.t).slice(0, 10) < day);
    if (dbars.length === 0) continue;
    const prevClose = dbars[dbars.length - 1].c;
    const dayBars = (pm.get(sym) ?? []).map((b) => ({ ...b, hm: etHm(b.t) }));
    if (dayBars.length === 0) continue;
    const res = runEngine(r.cls, dayBars, prevClose);
    for (const t of res.trades) {
      // Dedup: one (symbol,date) may map to multiple .md rows (scalper), but the
      // engine produces the authoritative trade set — push each engine trade once.
      if (candidates.some((c) => c.symbol === sym && c.date === day && c.entryHm === t.entryHm)) continue;
      candidates.push({
        symbol: sym, date: day, cls: r.cls, entryHm: t.entryHm,
        entry: t.entry, exit: t.exit, stop: t.stop, pnl: t.pnl,
        rMultiple: t.rMultiple, reason: t.reason,
        configHash: CONFIG_HASH, gitSha: SHA, reportRef: r.reportRef,
      });
    }
  }
  console.error(`${day}: ${syms.length} symbols -> ${candidates.filter((c) => c.date === day).length} re-run trades`);
}

writeFileSync(new URL("./candidates.json", import.meta.url), JSON.stringify(candidates, null, 2));
console.error(`wrote ${candidates.length} candidate trades -> tools/research/backfill/candidates.json`);
