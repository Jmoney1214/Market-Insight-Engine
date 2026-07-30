// LONG-ONLY test: does "only buy the runner when it RECLAIMS and HOLDS VWAP" beat the
// -2.3% blind-buy-at-open base rate (penny_runner_edge.mjs)? For every sub-$10 gap-runner
// day, walk the 5-min session: enter long the first time price posts TWO consecutive
// closes above VWAP (reclaimed + holding), exit on VWAP loss or at the close. No entry =
// stand aside (no trade). Long-only, next-bar fills, net of cost. No shorting, ever.
//   node --env-file=.env tools/router/penny_vwap_hold.mjs [--from=2026-04-01]
import { alpacaBars } from "../research/lib/data.mjs";
import { UNIVERSE } from "./config.mjs";

const FMP = process.env.FMP_API_KEY;
if (!process.env.ALPACA_API_KEY_ID || !process.env.ALPACA_API_SECRET_KEY) throw new Error("missing ALPACA creds");
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const FROM = arg("from", "2026-04-01"), TO = arg("to", "2026-07-28"), UNIV = arg("universe", "penny");
const GAP = Number(arg("pct", 20)) / 100, MINP = Number(arg("min", 0.30)), MAXP = Number(arg("max", 10)), MIN_DVOL = Number(arg("dvol", 20)) * 1e6, COST = Number(arg("cost", 0.5)) / 100;
const WARMUP = 3;  // skip the first ~15 min (opening chaos) before taking an entry
const EXIT = arg("exit", "tight");  // tight = exit on first close < VWAP; loose = 2 consecutive closes < VWAP

// universe -> daily bars -> gap-runner days (gap knowable at open, no look-ahead)
let syms;
if (UNIV === "router") syms = UNIVERSE;                     // 87 liquid large-caps
else {
  const u = new URL("https://financialmodelingprep.com/stable/company-screener");
  Object.entries({ priceLowerThan: MAXP, priceMoreThan: MINP, exchange: "NASDAQ,NYSE,AMEX",
    isEtf: false, isFund: false, isActivelyTrading: true, limit: 5000, apikey: FMP })
    .forEach(([k, v]) => u.searchParams.set(k, v));
  const rr = await fetch(u);
  if (!rr.ok) throw new Error(`FMP screener ${rr.status}`);
  syms = (await rr.json()).filter((x) => /^[A-Z]{1,5}$/.test(x.symbol)).map((x) => x.symbol);
}
const sortB = (raw) => [...raw].sort((a, b) => (a.t < b.t ? -1 : 1));

console.log(`\n=== VWAP-RECLAIM-HOLD (LONG-ONLY) · ${UNIV} · ${FROM}..${TO} · $${MINP}-$${MAXP}, gap>=${GAP * 100}%, $vol>=$${MIN_DVOL / 1e6}M · exit=${EXIT} ===`);
const daily = await alpacaBars(syms, "1Day", FROM, TO, `set_${UNIV}_1d`, 24);
const runnerDays = [];
for (const s of syms) {
  const raw = daily.get(s); if (!raw || raw.length < 2) continue;
  const b = sortB(raw);
  for (let i = 1; i < b.length; i++) {
    const prev = b[i - 1].c, d = b[i];
    if (!(prev > 0) || d.c < MINP || d.c > MAXP) continue;
    if ((d.o - prev) / prev < GAP) continue;
    if (d.c * (d.v || 0) < MIN_DVOL) continue;
    runnerDays.push({ s, date: d.t.slice(0, 10) });
  }
}
const names = [...new Set(runnerDays.map((r) => r.s))];
console.log(`${runnerDays.length} gap-runner days across ${names.length} names · pulling 5-min...\n`);

// one batched 5-min pull for the runner names over the window; slice per day
const intr = await alpacaBars(names, "5Min", FROM, TO, `set_${UNIV}_5m`, 24);

function vwapHoldTrade(day) {
  // cumulative session VWAP; enter on 2 consecutive closes > VWAP; exit on close<VWAP or EOD
  let pv = 0, vv = 0; const vwap = [];
  for (const x of day) { pv += (x.h + x.l + x.c) / 3 * x.v; vv += x.v; vwap.push(vv > 0 ? pv / vv : x.c); }
  let entryIdx = -1;
  for (let i = WARMUP; i < day.length - 1; i++) {
    if (day[i].c > vwap[i] && day[i - 1].c > vwap[i - 1]) { entryIdx = i + 1; break; } // fill next open
  }
  if (entryIdx < 0 || entryIdx >= day.length) return null; // stood aside
  const entry = day[entryIdx].o;
  for (let j = entryIdx; j < day.length; j++) {
    const below = day[j].c < vwap[j];
    const exitNow = EXIT === "loose" ? (below && day[j - 1].c < vwap[j - 1]) : below;
    if (exitNow) { const ex = j + 1 < day.length ? day[j + 1].o : day[j].c; return (ex - entry) / entry - COST; }
  }
  return (day[day.length - 1].c - entry) / entry - COST; // EOD exit
}

const rets = [], tradedList = [];
for (const rd of runnerDays) {
  const raw = intr.get(rd.s); if (!raw) continue;
  const OPEN = `${rd.date}T13:30:00Z`, CLOSE = `${rd.date}T20:00:00Z`; // 9:30-16:00 ET (EDT)
  const day = sortB(raw).filter((x) => x.t >= OPEN && x.t <= CLOSE);
  if (day.length < WARMUP + 3) continue;
  const r = vwapHoldTrade(day);
  rets.push(r == null ? 0 : r);
  if (r != null) tradedList.push(r);
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const pf = (n) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(2)}%`;
const perOpp = rets.length ? mean(rets) : 0;
console.log(`OPPORTUNITIES (runner-days evaluated): ${rets.length}`);
console.log(`  took a LONG on ${tradedList.length}  ·  stood aside on ${rets.length - tradedList.length}  (${(100 * tradedList.length / rets.length).toFixed(0)}% participation)\n`);
console.log(`── When it TRADED (reclaimed + held VWAP):`);
if (tradedList.length) {
  const w = tradedList.filter((x) => x > 0), l = tradedList.filter((x) => x <= 0);
  const PF = Math.abs(l.reduce((s, x) => s + x, 0)) > 0 ? w.reduce((s, x) => s + x, 0) / Math.abs(l.reduce((s, x) => s + x, 0)) : Infinity;
  console.log(`   avg ${pf(mean(tradedList)).padStart(8)}   median ${pf(median(tradedList)).padStart(8)}   green ${(100 * w.length / tradedList.length).toFixed(0)}%   PF ${PF.toFixed(2)}`);
}
console.log(`\n── Per OPPORTUNITY (stand-aside days count as 0 — the real per-runner expectancy):`);
console.log(`   avg ${pf(perOpp)}   vs blind-buy-at-open base rate -2.32%`);
console.log(`\n(net of ${COST * 100}% round-trip cost; sub-$10 fills optimistic → treat as an upper bound)\n`);
