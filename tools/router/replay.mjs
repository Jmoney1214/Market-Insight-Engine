// Replay the router AS-OF a past date using the exact live classify.mjs logic, then
// show how each signal actually played out. Run:
//   node --env-file=.env tools/router/replay.mjs --date=2026-07-20
import { alpacaBars, fmpEarnings } from "../research/lib/data.mjs";
import { daysBefore } from "../research/lib/dates.mjs";
import { UNIVERSE, THRESH } from "./config.mjs";
import { metricPack, route } from "./classify.mjs";

const asof = process.argv.find((a) => a.startsWith("--date="))?.split("=")[1] || "2026-07-20";
const start = daysBefore(asof, 430);
const end = "2026-08-31"; // past asof to capture outcomes; Alpaca returns through the last real bar

if (!process.env.ALPACA_API_KEY_ID || !process.env.ALPACA_API_SECRET_KEY) throw new Error("missing ALPACA creds");
const bars = await alpacaBars([...UNIVERSE, "SPY"], "1Day", start, end, "replay", 24);

const sortB = (raw) => [...raw].sort((a, b) => (a.t < b.t ? -1 : 1));
const idxAsof = (b) => { let i = -1; for (let k = 0; k < b.length; k++) { if (b[k].t.slice(0, 10) <= asof) i = k; else break; } return i; };

// SPY market regime as-of the replay date (SPY vs its own 200-SMA)
const spyB = sortB(bars.get("SPY"));
const spyIdx = idxAsof(spyB);
const spyPack = metricPack(spyB.slice(0, spyIdx + 1));
const spyRegimeOK = spyPack.sma200 != null && spyPack.close > spyPack.sma200;
const actualAsof = spyB[spyIdx].t.slice(0, 10);

// earnings-blackout as-of the replay date (same rule the live router applies):
// names reporting within mrEarningsBlackoutDays get their dip-buy suppressed.
let blackoutSet = new Set();
try {
  const earn = await fmpEarnings(actualAsof, daysBefore(actualAsof, -THRESH.mrEarningsBlackoutDays));
  const uni = new Set(UNIVERSE);
  for (const rec of earn) { const s = rec.slice(rec.lastIndexOf("|") + 1); if (uni.has(s)) blackoutSet.add(s); }
} catch (e) { console.error(`earnings blackout fetch failed (${e.message}) — none applied`); }

// classify every name using the same slice-to-asof trick (metricPack treats the last bar as "today")
const rows = [];
for (const sym of UNIVERSE) {
  const raw = bars.get(sym); if (!raw) continue;
  const b = sortB(raw);
  const ai = idxAsof(b);
  if (ai < 253) continue;
  const m = metricPack(b.slice(0, ai + 1));
  rows.push({ sym, ...route(m, spyRegimeOK, blackoutSet.has(sym)), metrics: m, b, ai });
}

const lastDate = spyB[spyB.length - 1].t.slice(0, 10);
const pct = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;

// forward outcome helpers (entry = next open after the signal)
function meanRevOutcome(row) {
  const { b, ai } = row, entryIdx = ai + 1;
  if (entryIdx >= b.length) return null;
  const entry = b[entryIdx].o;
  const sma5 = (i) => { if (i < 4) return null; let s = 0; for (let k = i - 4; k <= i; k++) s += b[k].c; return s / 5; };
  for (let e = entryIdx; e < b.length; e++) {
    const held = e - entryIdx;
    if ((sma5(e) != null && b[e].c > sma5(e)) || held >= THRESH.mrMaxHold) {
      const exit = e + 1 < b.length ? b[e + 1].o : b[e].c;
      const exitDate = (e + 1 < b.length ? b[e + 1] : b[e]).t.slice(0, 10);
      return { status: "closed", entry, exit, ret: (exit - entry) / entry - 0.0004, entryDate: b[entryIdx].t.slice(0, 10), exitDate, held: held + 1 };
    }
  }
  const last = b[b.length - 1];
  return { status: "open", entry, mark: last.c, ret: (last.c - entry) / entry, entryDate: b[entryIdx].t.slice(0, 10), markDate: last.t.slice(0, 10) };
}
function swingForward(row) {
  const { b, ai } = row, entryIdx = ai + 1;
  if (entryIdx >= b.length) return null;
  const entry = b[entryIdx].o, last = b[b.length - 1];
  return { entry, mark: last.c, ret: (last.c - entry) / entry, entryDate: b[entryIdx].t.slice(0, 10), markDate: last.t.slice(0, 10) };
}

const byProx = (a, b) => (b.metrics.pctVs20dHigh ?? -1e9) - (a.metrics.pctVs20dHigh ?? -1e9);
const breakout = rows.filter((r) => r.strategy === "TrendRider" && r.signal === "breakout").sort(byProx);
const coil = rows.filter((r) => r.strategy === "TrendRider" && r.signal === "coil").sort(byProx);
const meanrev = rows.filter((r) => r.strategy === "MeanRev").sort((a, b) => (a.metrics.rsi2 ?? 9) - (b.metrics.rsi2 ?? 9)).slice(0, THRESH.mrMaxConcurrent);
const cash = rows.filter((r) => r.strategy === "Cash").length;

console.log(`\n=== ROUTER REPLAY — as-of ${actualAsof} · act at next open · outcomes through ${lastDate} ===`);
console.log(`SPY regime: close $${spyPack.close.toFixed(2)} vs 200-SMA $${spyPack.sma200.toFixed(2)} → ${spyRegimeOK ? "ON (dip-buys enabled)" : "OFF (MeanRev blocked)"}\n`);

console.log(`🟢 TrendRider BREAKOUT (buy) — ${breakout.length}`);
breakout.forEach((r) => console.log(`  ${r.sym.padEnd(6)} ${r.reason}`));
console.log(`\n🟡 TrendRider COIL (watch) — ${coil.length}`);
coil.slice(0, 8).forEach((r) => console.log(`  ${r.sym.padEnd(6)} ${r.reason}`));
console.log(`\n🟣 MeanRev DIP-BUY (RSI2, capped ${THRESH.mrMaxConcurrent}) — ${meanrev.length}`);
meanrev.forEach((r) => console.log(`  ${r.sym.padEnd(6)} RSI2 ${String(Math.round(r.metrics.rsi2)).padStart(2)}  (px $${r.metrics.close.toFixed(2)})`));
console.log(`\n⬛ Cash — ${cash}`);

console.log(`\n=== HOW THE MeanRev DIP-BUYS PLAYED OUT (paper) ===`);
let sum = 0, wins = 0, cnt = 0;
for (const r of meanrev) {
  const o = meanRevOutcome(r); if (!o) continue;
  cnt++; sum += o.ret; if (o.ret > 0) wins++;
  const tail = o.status === "closed"
    ? `entry ${o.entryDate} $${o.entry.toFixed(2)} → exit ${o.exitDate} $${o.exit.toFixed(2)}  (${o.held}d)`
    : `entry ${o.entryDate} $${o.entry.toFixed(2)} → still open, mark ${o.markDate} $${o.mark.toFixed(2)}`;
  console.log(`  ${r.sym.padEnd(6)} ${pct(o.ret).padStart(8)}   ${tail}`);
}
if (cnt) console.log(`  ── basket: ${cnt} trades · avg ${pct(sum / cnt)} · win ${(100 * wins / cnt).toFixed(0)}%`);

console.log(`\n=== TrendRider swing positions (still open, unrealized through ${lastDate}) ===`);
for (const r of [...breakout, ...coil.slice(0, 5)]) {
  const f = swingForward(r); if (!f) continue;
  console.log(`  ${r.sym.padEnd(6)} ${pct(f.ret).padStart(8)}   entry ${f.entryDate} $${f.entry.toFixed(2)} → ${f.markDate} $${f.mark.toFixed(2)}`);
}
console.log("");
