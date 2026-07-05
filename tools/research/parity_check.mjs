// Pine <-> Node empirical parity checker (regression guard).
//   node parity_check.mjs --csv <TradingView Strategy Tester export> --symbol HIMS --class rider
// Diffs the TradingView trade list against the harness engine on the same
// (symbol, day)s and classifies every difference:
//   MATCH           same entry bar (±1), same exit reason
//   FILL_DIFF       same signal, prices differ (fill model / feed) — expected, quantified
//   EXIT_DIFF       same entry, different exit time or reason
//   SIGNAL_MISMATCH trade exists on one side only — a REAL drift candidate
// Run with --fill tv_ohlc_path to remove the intrabar-resolution difference.
import { readFileSync } from "node:fs";
import { etWindow, etHm, daysBefore } from "./lib/dates.mjs";
import { requireCreds, alpacaBars } from "./lib/data.mjs";
import { runEngine } from "./lib/engine.mjs";

const get = (f) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : undefined; };
const csvPath = get("--csv"), symbol = get("--symbol"), cls = get("--class") ?? "rider";
const fill = get("--fill") ?? "tv_ohlc_path";
if (!csvPath || !symbol) {
  console.error("usage: node parity_check.mjs --csv <export.csv> --symbol SYM [--class rider|scalper] [--fill tv_ohlc_path]");
  process.exit(2);
}
requireCreds();

// TradingView export: rows come in pairs (Exit + Entry) per trade number.
const rows = readFileSync(csvPath, "utf8").trim().split("\n").map((l) => l.split(","));
const header = rows[0];
const col = (name) => header.findIndex((h) => h.trim().toLowerCase().startsWith(name));
const iNum = col("trade number"), iType = col("type"), iTime = col("date and time"),
  iPrice = col("price"), iPnl = col("net pnl");
const tv = new Map(); // tradeNum -> {day, entryHm, exitHm, entryPx, exitPx, pnl}
for (const r of rows.slice(1)) {
  const n = r[iNum], type = r[iType], [day, hm] = r[iTime].split(" ");
  const rec = tv.get(n) ?? { day };
  if (/entry/i.test(type)) { rec.entryHm = hm; rec.entryPx = +r[iPrice]; }
  else { rec.exitHm = hm; rec.exitPx = +r[iPrice]; rec.pnl = +r[iPnl]; }
  tv.set(n, rec);
}
const tvTrades = [...tv.values()].filter((t) => t.entryHm);
const days = [...new Set(tvTrades.map((t) => t.day))].sort();
console.error(`TV export: ${tvTrades.length} trades across ${days.length} day(s) for ${symbol} (class ${cls}, fill ${fill})`);

const hmMinutes = (hm) => +hm.slice(0, 2) * 60 + +hm.slice(3, 5);
const near = (a, b, mins = 5) => Math.abs(hmMinutes(a) - hmMinutes(b)) <= mins;

const results = [];
for (const day of days) {
  const daily = await alpacaBars([symbol], "1Day", `${daysBefore(day, 30)}T00:00:00Z`, `${day}T23:59:59Z`, `pchk_d_${symbol}_${day}`);
  const hist = (daily.get(symbol) ?? []).filter((b) => b.t.slice(0, 10) < day);
  const w = etWindow(day, "04:00", "20:00");
  const full = await alpacaBars([symbol], "5Min", w.start, w.end, `pchk_f_${symbol}_${day}`);
  const bars = (full.get(symbol) ?? []).map((b) => ({ ...b, hm: etHm(b.t) }));
  const res = runEngine(cls, bars, hist.at(-1)?.c, fill);
  const nodeTrades = res.trades ?? [];
  const tvDay = tvTrades.filter((t) => t.day === day);
  const usedNode = new Set();
  for (const t of tvDay) {
    const m = nodeTrades.find((n, i) => !usedNode.has(i) && near(n.entryHm, t.entryHm) && usedNode.add(i) !== false);
    if (!m) { results.push({ day, verdict: "SIGNAL_MISMATCH", side: "tv-only", tv: t }); continue; }
    const exitOk = near(m.exitHm, t.exitHm, 10);
    const pxDelta = Math.abs(m.entry - t.entryPx);
    if (!exitOk) results.push({ day, verdict: "EXIT_DIFF", tv: t, node: m });
    else if (pxDelta > Math.max(0.05, t.entryPx * 0.002)) results.push({ day, verdict: "FILL_DIFF", pxDelta: +pxDelta.toFixed(3), tv: t, node: m });
    else results.push({ day, verdict: "MATCH", tv: t, node: m });
  }
  nodeTrades.forEach((n, i) => {
    if (!usedNode.has(i)) results.push({ day, verdict: "SIGNAL_MISMATCH", side: "node-only", node: n, status: res.status });
  });
  if (!tvDay.length && !nodeTrades.length)
    results.push({ day, verdict: "MATCH", note: `both flat (${res.status})` });
}

const counts = {};
for (const r of results) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
console.log(JSON.stringify({ symbol, cls, fill, counts, results }, null, 1));
const drift = (counts.SIGNAL_MISMATCH ?? 0) + (counts.EXIT_DIFF ?? 0);
console.error(`verdict: ${drift === 0 ? "PARITY OK" : `DRIFT: ${drift} signal/exit mismatch(es)`} · ${JSON.stringify(counts)}`);
process.exit(drift === 0 ? 0 : 1);
