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
import { matchByTime, tally } from "./lib/parity.mjs";

const get = (f) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : undefined; };
const csvPath = get("--csv"), symbol = get("--symbol"), cls = get("--class") ?? "rider";
const fill = get("--fill") ?? "tv_ohlc_path";
if (!csvPath || !symbol) {
  console.error("usage: node parity_check.mjs --csv <export.csv> --symbol SYM [--class rider|scalper] [--fill tv_ohlc_path]");
  process.exit(2);
}
requireCreds();

// TradingView export: rows come in pairs (Exit + Entry) per trade number.
// Split on \r?\n (Windows exports) and on commas OUTSIDE quoted fields.
const rows = readFileSync(csvPath, "utf8").trim().split(/\r?\n/)
  .map((l) => l.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map((c) => c.replace(/^"|"$/g, "")));
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

const results = [];
for (const day of days) {
  const daily = await alpacaBars([symbol], "1Day", `${daysBefore(day, 30)}T00:00:00Z`, `${day}T23:59:59Z`, `pchk_d_${symbol}_${day}`);
  const hist = (daily.get(symbol) ?? []).filter((b) => b.t.slice(0, 10) < day);
  const w = etWindow(day, "04:00", "20:00");
  const full = await alpacaBars([symbol], "5Min", w.start, w.end, `pchk_f_${symbol}_${day}`);
  const bars = (full.get(symbol) ?? []).map((b) => ({ ...b, hm: etHm(b.t) }));
  const res = runEngine(cls, bars, hist.at(-1)?.c, fill);
  const tvDay = tvTrades.filter((t) => t.day === day);
  results.push(...matchByTime(tvDay, res.trades ?? [], { day, status: res.status }));
}

const { counts, drift } = tally(results);
console.log(JSON.stringify({ symbol, cls, fill, counts, results }, null, 1));
console.error(`verdict: ${drift === 0 ? "PARITY OK" : `DRIFT: ${drift} signal/exit mismatch(es)`} · ${JSON.stringify(counts)}`);
process.exit(drift === 0 ? 0 : 1);
