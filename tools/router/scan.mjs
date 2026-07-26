// Strategy Router — Phase 1 swing scan.
// Fetch cached SIP daily bars for the 87-name universe, classify each ticker's
// character, route to a lane (LIVE TrendRider vs Cash; range flagged PAPER),
// print a ranked table, and persist JSON. Run:
//   node --env-file=.env tools/router/scan.mjs
import { requireCreds, alpacaBars, stampMetadata } from "../research/lib/data.mjs";
import { daysBefore } from "../research/lib/dates.mjs";
import { UNIVERSE } from "./config.mjs";
import { metricPack, route, routePremarket } from "./classify.mjs";
import { snapshots } from "./sources.mjs";
import { writeScan, pushSupabase } from "./store.mjs";
import { sendSlack } from "./notify.mjs";

// "Today" in America/New_York, not UTC — after ~8pm ET, UTC has already rolled
// to tomorrow, which would push the banner/fetch window/filename a day ahead.
const etToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()); // "YYYY-MM-DD"
const end = etToday();
const start = daysBefore(end, 430); // ~14 months for 200-SMA + 52w
const mode = process.argv.find((a) => a.startsWith("--mode="))?.split("=")[1] || "swing";
const doPremarket = mode === "premarket" || mode === "both";

requireCreds();
console.log(`\nStrategy Router — ${mode} scan  ${start}..${end}  (${UNIVERSE.length} names)\n`);

// 6h TTL: refreshes through the trading day, still cached for rapid reruns.
const bars = await alpacaBars(UNIVERSE, "1Day", start, end, "router_daily", 6);

const rows = [];
for (const sym of UNIVERSE) {
  const b = bars.get(sym);
  if (!b || b.length < 210) { rows.push({ sym, error: `insufficient bars (${b ? b.length : 0})` }); continue; }
  const m = metricPack(b);
  rows.push({ sym, ...route(m), metrics: m });
}

if (doPremarket) {
  const snaps = await snapshots(UNIVERSE);
  for (const r of rows) {
    if (r.error) continue;
    const s = snaps.get(r.sym);
    const volSurge = s && r.metrics.avgVol20 ? s.dayVol / r.metrics.avgVol20 : null;
    const pr = routePremarket(s ? { ...s, volSurge } : null, r.metrics);
    r.premarket = { ...pr, price: s?.price ?? null, volSurge };
    r.metrics.premarket = r.premarket; // folded into the jsonb DB sink
  }
}

const ok = rows.filter((r) => !r.error);
const asOf = ok[0]?.metrics?.date || end;
const byProx = (a, b) => (b.metrics.pctVs20dHigh ?? -1e9) - (a.metrics.pctVs20dHigh ?? -1e9);
const pick = (fn) => ok.filter(fn).sort(byProx);

const breakout = pick((r) => r.strategy === "TrendRider" && r.signal === "breakout");
const coil = pick((r) => r.strategy === "TrendRider" && r.signal === "coil");
const paper = pick((r) => r.status === "PAPER");
const cash = ok.filter((r) => r.strategy === "Cash");
const errs = rows.filter((r) => r.error);
const gappers = doPremarket
  ? ok.filter((r) => r.premarket && (r.premarket.lane === "Momentum" || r.premarket.lane === "JumpDay"))
      .sort((a, b) => (b.premarket.gapPct ?? -1e9) - (a.premarket.gapPct ?? -1e9))
  : [];

const line = (r) => `  ${r.sym.padEnd(6)} ${String(r.metrics.pctVs20dHigh?.toFixed(2)).padStart(7)}%  ${r.reason}`;
console.log(`🟢 LIVE · TrendRider BREAKOUT (buy) — ${breakout.length}`);
breakout.forEach((r) => console.log(line(r)));
console.log(`\n🟡 LIVE · TrendRider COIL (watch) — ${coil.length}`);
coil.forEach((r) => console.log(line(r)));
console.log(`\n⚪ PAPER · range flags (unvalidated) — ${paper.length}`);
paper.forEach((r) => console.log(line(r)));
if (doPremarket) {
  console.log(`\n🔵 PAPER · PREMARKET GAP LANES — ${gappers.length}`);
  gappers.forEach((r) => console.log(`  ${r.sym.padEnd(6)} ${r.premarket.lane.padEnd(9)} ${r.premarket.note}${r.premarket.price ? " · $" + r.premarket.price.toFixed(2) : ""}`));
}
console.log(`\n⬛ CASH — ${cash.length}   ·   errors — ${errs.length}`);
errs.forEach((r) => console.log(`  ${r.sym.padEnd(6)} ${r.error}`));

const scan = {
  date: asOf, mode,
  generated: stampMetadata({ from: start, to: end, fill: "n/a (screen only)" }),
  counts: { breakout: breakout.length, coil: coil.length, paper: paper.length, cash: cash.length, errors: errs.length, premarketGappers: gappers.length },
  rows,
};
console.log(`\nsaved → ${writeScan(scan)}`);

if (process.argv.includes("--db")) {
  try { console.log(`DB    → upserted ${await pushSupabase(scan)} rows to router_scan`); }
  catch (e) { console.error(`DB push failed: ${e.message}`); }
}
if (process.argv.includes("--slack")) {
  try { console.log(`Slack → sent "${await sendSlack(scan)}"`); }
  catch (e) { console.error(`Slack ping failed: ${e.message}`); }
}
console.log("");
