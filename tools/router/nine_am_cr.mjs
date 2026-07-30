// Mechanized LONG-ONLY 9AM CR (Candle Range) model, no look-ahead. The 8:00-9:00 AM ET
// candle = the range. During the open, price must SWEEP the range LOW (liquidity purge)
// then RECLAIM it → BUY; stop = the sweep low, target = the range HIGH (opposite
// liquidity), flat by close. Only the bullish sweep-low-reclaim (long-only; no shorting).
// EDT-only windows so the 8-9AM ET boundary is a fixed UTC offset (no DST bug).
//   node --env-file=.env tools/router/nine_am_cr.mjs --universe=router|penny [--from --to --cost]
import { alpacaBars } from "../research/lib/data.mjs";
import { UNIVERSE } from "./config.mjs";

const FMP = process.env.FMP_API_KEY;
if (!process.env.ALPACA_API_KEY_ID || !process.env.ALPACA_API_SECRET_KEY) throw new Error("missing ALPACA creds");
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const FROM = arg("from", "2026-04-01"), TO = arg("to", "2026-07-28"), UNIV = arg("universe", "router");
const MINP = Number(arg("min", 2)), MAXP = Number(arg("max", 15)), GAP = Number(arg("pct", 5)) / 100, MIN_DVOL = Number(arg("dvol", 20)) * 1e6, COST = Number(arg("cost", 0.5)) / 100;
// EDT (UTC-4): 8-9AM ET = 12:00-13:00Z; RTH 9:30-16:00 = 13:30-20:00Z; entry window ends 1PM = 17:00Z
const PM0 = "12:00:00", PM1 = "13:00:00", R0 = "13:30:00", ENTRY_END = "17:00:00", R1 = "20:00:00";
const sortB = (raw) => [...raw].sort((a, b) => (a.t < b.t ? -1 : 1));
const tod = (b) => b.t.slice(11, 19);

let syms, candidates; // candidates = [{s, date}]
if (UNIV === "router") {
  syms = UNIVERSE;
} else {
  const u = new URL("https://financialmodelingprep.com/stable/company-screener");
  Object.entries({ priceLowerThan: MAXP, priceMoreThan: MINP, exchange: "NASDAQ,NYSE,AMEX",
    isEtf: false, isFund: false, isActivelyTrading: true, limit: 5000, apikey: FMP })
    .forEach(([k, v]) => u.searchParams.set(k, v));
  const rr = await fetch(u); if (!rr.ok) throw new Error(`FMP screener ${rr.status}`);
  syms = (await rr.json()).filter((x) => /^[A-Z]{1,5}$/.test(x.symbol)).map((x) => x.symbol);
}

console.log(`\n=== 9AM CR (LONG-ONLY) · ${UNIV} · ${FROM}..${TO} · sweep 8-9AM low -> reclaim -> target 8-9AM high ===`);
if (UNIV === "penny") {
  const daily = await alpacaBars(syms, "1Day", FROM, TO, "cr_penny_1d", 24);
  candidates = [];
  for (const s of syms) {
    const raw = daily.get(s); if (!raw || raw.length < 2) continue;
    const b = sortB(raw);
    for (let i = 1; i < b.length; i++) {
      const prev = b[i - 1].c, d = b[i];
      if (!(prev > 0) || d.c < MINP || d.c > MAXP) continue;
      if ((d.o - prev) / prev < GAP) continue;
      if (d.c * (d.v || 0) < MIN_DVOL) continue;
      candidates.push({ s, date: d.t.slice(0, 10) });
    }
  }
}
const names = UNIV === "router" ? syms : [...new Set(candidates.map((c) => c.s))];
console.log(`pulling 5-min (premarket + RTH) for ${names.length} names...\n`);
const intr = await alpacaBars(names, "5Min", FROM, TO, `cr_${UNIV}_5m`, 24);

// build per-name per-date bar map
const byND = new Map(); // key `${s}|${date}` -> bars[]
for (const s of names) {
  const raw = intr.get(s); if (!raw) continue;
  for (const b of sortB(raw)) {
    const k = `${s}|${b.t.slice(0, 10)}`;
    if (!byND.has(k)) byND.set(k, []);
    byND.get(k).push(b);
  }
}
if (UNIV === "router") {
  candidates = [];
  for (const k of byND.keys()) { const [s, date] = k.split("|"); candidates.push({ s, date }); }
}

function crTrade(bars) {
  const pm = bars.filter((b) => tod(b) >= PM0 && tod(b) < PM1);
  if (pm.length < 1) return { r: null, valid: false };            // no 8-9AM candle -> model can't apply
  const preHigh = Math.max(...pm.map((b) => b.h)), preLow = Math.min(...pm.map((b) => b.l));
  const rth = bars.filter((b) => tod(b) >= R0 && tod(b) <= R1);
  if (rth.length < 3) return { r: null, valid: false };
  let swept = false, sweepLow = Infinity, entryIdx = -1;
  for (let i = 0; i < rth.length; i++) {
    if (tod(rth[i]) > ENTRY_END) break;                            // entry window closed (past 1PM)
    if (rth[i].l < preLow) { swept = true; sweepLow = Math.min(sweepLow, rth[i].l); }
    if (swept && rth[i].c > preLow) { entryIdx = i + 1; break; }    // reclaim -> fill next bar
  }
  if (entryIdx < 0 || entryIdx >= rth.length) return { r: null, valid: true };  // valid setup universe, stood aside
  const entry = rth[entryIdx].o, stop = sweepLow, target = preHigh, risk = entry - stop;
  if (risk <= 0 || target <= entry) return { r: null, valid: true };
  for (let e = entryIdx; e < rth.length; e++) {
    if (rth[e].l <= stop) return { r: (stop - entry) / entry - COST, valid: true };
    if (rth[e].h >= target) return { r: (target - entry) / entry - COST, valid: true };
  }
  return { r: (rth[rth.length - 1].c - entry) / entry - COST, valid: true };
}

const rets = [], traded = []; let noRange = 0;
for (const c of candidates) {
  const bars = byND.get(`${c.s}|${c.date}`); if (!bars) continue;
  const { r, valid } = crTrade(bars);
  if (!valid) { noRange++; continue; }
  rets.push(r == null ? 0 : r);
  if (r != null) traded.push(r);
}

const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const pf = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;
console.log(`candidate name-days: ${candidates.length}  ·  no 8-9AM range (skipped): ${noRange}  ·  valid: ${rets.length}`);
console.log(`  CR long fired on ${traded.length}  ·  stood aside ${rets.length - traded.length}  (${(100 * traded.length / (rets.length || 1)).toFixed(0)}% participation)`);
if (traded.length) {
  const w = traded.filter((x) => x > 0), l = traded.filter((x) => x <= 0);
  const PF = Math.abs(l.reduce((s, x) => s + x, 0)) > 0 ? w.reduce((s, x) => s + x, 0) / Math.abs(l.reduce((s, x) => s + x, 0)) : Infinity;
  console.log(`── When it fired:  avg ${pf(mean(traded))}   median ${pf(median(traded))}   green ${(100 * w.length / traded.length).toFixed(0)}%   PF ${PF.toFixed(2)}`);
}
console.log(`── Per OPPORTUNITY (stand-aside = 0):  avg ${pf(mean(rets))}`);
console.log("");
