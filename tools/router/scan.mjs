// Strategy Router — Phase 1 swing scan.
// Fetch cached SIP daily bars for the 87-name universe, classify each ticker's
// character, route to a lane (LIVE TrendRider vs Cash; range flagged PAPER),
// print a ranked table, and persist JSON. Run:
//   node --env-file=.env tools/router/scan.mjs
import { alpacaBars, fmpEarnings, gitSha } from "../research/lib/data.mjs";
import { daysBefore } from "../research/lib/dates.mjs";
import { UNIVERSE, THRESH } from "./config.mjs";
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

// Market-regime gate for the MeanRev dip-buy (Phase-4 validated rule): only take
// the dip when the BROAD MARKET (SPY) is itself above its own 200SMA — buy
// pullbacks WITHIN an uptrend, don't catch falling knives in a downtrend. Fetched
// once here (own cache namespace) and reused for every symbol's route() call
// below — leak-free, built from SPY's own completed daily bars only.
const spyBarsMap = await alpacaBars(["SPY"], "1Day", start, end, "regime_spy", 6);
const spyBars = spyBarsMap.get("SPY");
let spyRegimeOK = false, spyClose = null, spySma200 = null;
if (spyBars && spyBars.length >= 253) {
  const spyPack = metricPack(spyBars);
  spyClose = spyPack.close;
  spySma200 = spyPack.sma200;
  spyRegimeOK = spySma200 != null && spyClose > spySma200;
} else {
  console.error(`SPY regime bars insufficient (${spyBars ? spyBars.length : 0}) — spyRegimeOK defaulting to false, MeanRev dip-buy suppressed this run`);
}
console.log(`SPY regime: close $${spyClose != null ? spyClose.toFixed(2) : "–"} vs SMA200 $${spySma200 != null ? spySma200.toFixed(2) : "–"} → ${spyRegimeOK ? "ON (above 200SMA)" : "OFF (below/at 200SMA)"}\n`);

// Earnings-blackout gate for the MeanRev dip-buy (Phase-4e validated rule, same
// as validate.mjs/stress.mjs): skip a dip-buy if the name reports earnings within
// THRESH.mrEarningsBlackoutDays of today. Forward-only window off the scan date
// (no chunking needed — 7 days is far below FMP's per-request cap). A transient
// FMP failure must not abort the run — the swing board still has value without it.
const blackoutTo = daysBefore(end, -THRESH.mrEarningsBlackoutDays); // daysBefore(day, -n) == n days AFTER day
let blackoutSet = new Set();
try {
  const earn = await fmpEarnings(end, blackoutTo);
  const uniSet = new Set(UNIVERSE);
  for (const rec of earn) {
    const i = rec.lastIndexOf("|");
    const sym = rec.slice(i + 1);
    if (uniSet.has(sym)) blackoutSet.add(sym);
  }
  console.log(`earnings blackout: ${blackoutSet.size} universe name(s) reporting ${end}..${blackoutTo} (≤${THRESH.mrEarningsBlackoutDays}d)${blackoutSet.size ? ": " + [...blackoutSet].sort().join(", ") : ""}`);
} catch (e) {
  console.error(`earnings blackout fetch failed (${e.message}) — treating blackoutSet as empty this run, MeanRev dip-buy not earnings-filtered`);
}

const rows = [];
for (const sym of UNIVERSE) {
  const b = bars.get(sym);
  // 253 = full 52-week (252) + the current bar; the floor must clear hi52N (252)
  // or pctVs52 silently goes null for names sitting just under the old 210 floor.
  if (!b || b.length < 253) { rows.push({ sym, error: `insufficient bars (${b ? b.length : 0})` }); continue; }
  const m = metricPack(b);
  rows.push({ sym, ...route(m, spyRegimeOK, blackoutSet.has(sym)), metrics: m });
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

// MeanRev position cap: rank today's dip-buy candidates by RSI2 ascending (most
// oversold first) and tag only the top mrMaxConcurrent as in-cap — the rest waitlist.
// capStatus is written onto both the row AND its metrics object (the latter is what
// pushSupabase serializes into the `metrics` jsonb column, so it survives the DB sink).
const meanRev = ok.filter((r) => r.strategy === "MeanRev")
  .sort((a, b) => (a.metrics.rsi2 ?? 1e9) - (b.metrics.rsi2 ?? 1e9));
meanRev.forEach((r, i) => {
  r.capStatus = i < THRESH.mrMaxConcurrent ? "in-cap" : "waitlist";
  r.metrics.capStatus = r.capStatus;
});
const meanRevInCap = meanRev.filter((r) => r.capStatus === "in-cap");
const meanRevOverCap = meanRev.filter((r) => r.capStatus === "waitlist");

// Names that would have routed to MeanRev (RSI2-oversold, above 200SMA) but were
// diverted to Cash purely by the earnings-blackout gate — visibility into what
// the filter actually removed today.
const suppressed = ok.filter((r) =>
  r.metrics.rsi2 != null && r.metrics.rsi2 < THRESH.mrRsiEntry &&
  r.metrics.sma200 != null && r.metrics.close > r.metrics.sma200 &&
  blackoutSet.has(r.sym));

const line = (r) => `  ${r.sym.padEnd(6)} ${String(r.metrics.pctVs20dHigh?.toFixed(2)).padStart(7)}%  ${r.reason}`;
const r0 = (v) => (v == null ? "–" : Math.round(v));
console.log(`🟢 LIVE · TrendRider BREAKOUT (buy) — ${breakout.length}`);
breakout.forEach((r) => console.log(line(r)));
console.log(`\n🟡 LIVE · TrendRider COIL (watch) — ${coil.length}`);
coil.forEach((r) => console.log(line(r)));
console.log(`\n🟣 PAPER · MeanRev DIP-BUY (validated rule, paper-trade) — ${meanRevInCap.length}`);
meanRevInCap.forEach((r) => console.log(`  ${r.sym.padEnd(6)} RSI2 ${String(r0(r.metrics.rsi2)).padStart(3)}  ${r.reason}`));
if (meanRevOverCap.length) console.log(`  (+${meanRevOverCap.length} over cap — waitlist)`);
console.log(`  (${suppressed.length} dip candidate${suppressed.length === 1 ? "" : "s"} suppressed by earnings blackout ≤${THRESH.mrEarningsBlackoutDays}d: ${suppressed.length ? suppressed.map((r) => r.sym).join(", ") : "none"})`);
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
