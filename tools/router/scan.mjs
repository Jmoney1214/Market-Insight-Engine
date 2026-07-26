// Strategy Router — Phase 1 swing scan.
// Fetch cached SIP daily bars for the 87-name universe, classify each ticker's
// character, route to a lane (LIVE TrendRider vs Cash; range flagged PAPER),
// print a ranked table, and persist JSON. Run:
//   node --env-file=.env tools/router/scan.mjs
import { alpacaBars, gitSha } from "../research/lib/data.mjs";
import { daysBefore } from "../research/lib/dates.mjs";
import { UNIVERSE } from "./config.mjs";
import { metricPack, route, routePremarket } from "./classify.mjs";
import { snapshots } from "./sources.mjs";
import { writeScan, pushSupabase } from "./store.mjs";

// The router only ever talks to Alpaca (bars + snapshots) — data.mjs's requireCreds()
// also hard-requires FMP_API_KEY, which this tool never uses. Router-local check.
function requireRouterCreds() {
  const missing = [
    !process.env.ALPACA_API_KEY_ID && "ALPACA_API_KEY_ID",
    !process.env.ALPACA_API_SECRET_KEY && "ALPACA_API_SECRET_KEY",
  ].filter(Boolean);
  if (missing.length) throw new Error(`missing env credentials: ${missing.join(", ")}`);
}

// "Today" in America/New_York, not UTC — after ~8pm ET, UTC has already rolled
// to tomorrow, which would push the banner/fetch window/filename a day ahead.
const etToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()); // "YYYY-MM-DD"
const end = etToday();
const start = daysBefore(end, 430); // ~14 months for 200-SMA + 52w
const mode = process.argv.find((a) => a.startsWith("--mode="))?.split("=")[1] || "swing";
const doPremarket = mode === "premarket" || mode === "both";

requireRouterCreds();
console.log(`\nStrategy Router — ${mode} scan  ${start}..${end}  (${UNIVERSE.length} names)\n`);

// 6h TTL: refreshes through the trading day, still cached for rapid reruns.
const bars = await alpacaBars(UNIVERSE, "1Day", start, end, "router_daily", 6);

const rows = [];
for (const sym of UNIVERSE) {
  const b = bars.get(sym);
  // 253 = full 52-week (252) + the current bar; the floor must clear hi52N (252)
  // or pctVs52 silently goes null for names sitting just under the old 210 floor.
  if (!b || b.length < 253) { rows.push({ sym, error: `insufficient bars (${b ? b.length : 0})` }); continue; }
  const m = metricPack(b);
  rows.push({ sym, ...route(m), metrics: m });
}

if (doPremarket) {
  // A transient Alpaca snapshots error must not abort the whole run — the swing
  // board (already classified above) still has value on its own.
  try {
    const { snaps, missing } = await snapshots(UNIVERSE);
    if (missing.length)
      console.error(`premarket snapshots: ${missing.length} symbol(s) missing from Alpaca response — ${missing.join(", ")}`);
    for (const r of rows) {
      if (r.error) continue;
      const s = snaps.get(r.sym);
      const volSurge = s && r.metrics.avgVol20 ? s.dayVol / r.metrics.avgVol20 : null;
      const pr = routePremarket(s ? { ...s, volSurge } : null, r.metrics, end);
      r.premarket = { ...pr, price: s?.price ?? null, volSurge };
      r.metrics.premarket = r.premarket; // folded into the jsonb DB sink
    }
  } catch (e) {
    console.error(`premarket snapshots fetch failed (${e.message}) — continuing with swing board only, no premarket lanes this run`);
  }
}

const ok = rows.filter((r) => !r.error);
// scan.date must represent the SESSION being scanned, not just "whatever bar
// happened to be last": in premarket/both mode the run targets today's ET session
// (bars won't have formed yet), so use the ET trading date; swing (EOD) mode keeps
// the last-completed-bar date, which is what "today's swing board" actually means.
const asOf = doPremarket ? end : (ok[0]?.metrics?.date || end);
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

// Screen-appropriate provenance — NOT the backtest harness's stampMetadata(), which
// would inject false context (fill costs, $25k sizing, 5Min timeframe, pm/RTH/flatten
// session template) into what is actually a daily-bar screen with no fills at all.
const provenance = {
  generatedAt: new Date().toISOString(),
  gitSha: gitSha(),
  dataProvider: "Alpaca SIP daily bars",
  feed: "sip",
  adjustment: "split",
  barTimeframe: "1Day",
  universe: "87-name trend_universe",
  dateRange: `${start}..${end}`,
  mode,
};

const scan = {
  date: asOf, mode,
  generated: provenance,
  counts: { breakout: breakout.length, coil: coil.length, paper: paper.length, cash: cash.length, errors: errs.length, premarketGappers: gappers.length },
  rows,
};
console.log(`\nsaved → ${writeScan(scan)}`);

if (process.argv.includes("--db")) {
  try { console.log(`DB    → upserted ${await pushSupabase(scan)} rows to router_scan`); }
  catch (e) { console.error(`DB push failed: ${e.message}`); }
}
console.log("");
