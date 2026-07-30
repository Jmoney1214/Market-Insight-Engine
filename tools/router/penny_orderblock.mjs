// LONG-ONLY mechanical ORDER BLOCK on 5-min, $15-and-below. No look-ahead, no shorting.
// Setup (all on CLOSED bars): (1) uptrend — bar closes above VWAP; (2) DISPLACEMENT —
// close breaks the prior BRK-bar swing high by >= DISP*ATR with a bullish bar;
// (3) ORDER BLOCK = the last DOWN candle before that displacement (its low..high = the
// demand zone); (4) BUY when price retraces back into the zone and holds (doesn't close
// below the block low) — fill next open; (5) stop just below the block low, target 2R,
// else EOD. Buy -> sell. Tested on the same runner-day framework as the other probes.
//   node --env-file=.env tools/router/penny_orderblock.mjs [--from --to --min --max --pct --cost]
import { alpacaBars } from "../research/lib/data.mjs";

const FMP = process.env.FMP_API_KEY;
if (!process.env.ALPACA_API_KEY_ID || !process.env.ALPACA_API_SECRET_KEY) throw new Error("missing ALPACA creds");
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const FROM = arg("from", "2026-04-01"), TO = arg("to", "2026-07-28");
const GAP = Number(arg("pct", 5)) / 100, MINP = Number(arg("min", 2)), MAXP = Number(arg("max", 15)), MIN_DVOL = Number(arg("dvol", 20)) * 1e6, COST = Number(arg("cost", 0.5)) / 100;
const BRK = Number(arg("brk", 10)), DISP = Number(arg("disp", 0.25)), TGT_R = Number(arg("tgtR", 2)), ATRL = 14, WARMUP = 5;

const u = new URL("https://financialmodelingprep.com/stable/company-screener");
Object.entries({ priceLowerThan: MAXP, priceMoreThan: MINP, exchange: "NASDAQ,NYSE,AMEX",
  isEtf: false, isFund: false, isActivelyTrading: true, limit: 5000, apikey: FMP })
  .forEach(([k, v]) => u.searchParams.set(k, v));
const rr = await fetch(u); if (!rr.ok) throw new Error(`FMP screener ${rr.status}`);
const syms = (await rr.json()).filter((x) => /^[A-Z]{1,5}$/.test(x.symbol)).map((x) => x.symbol);
const sortB = (raw) => [...raw].sort((a, b) => (a.t < b.t ? -1 : 1));

console.log(`\n=== ORDER BLOCK (LONG-ONLY, 5m) · $${MINP}-$${MAXP} runners (gap>=${GAP * 100}%) · ${FROM}..${TO} · stop=OB-low, target=${TGT_R}R ===`);
const daily = await alpacaBars(syms, "1Day", FROM, TO, "ob_1d", 24);
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
console.log(`${runnerDays.length} runner-days across ${names.length} names · pulling 5-min...\n`);
const intr = await alpacaBars(names, "5Min", FROM, TO, "ob_5m", 24);

function obTrade(day) {
  const n = day.length;
  const vwap = new Array(n); { let pv = 0, vv = 0; for (let x = 0; x < n; x++) { pv += (day[x].h + day[x].l + day[x].c) / 3 * day[x].v; vv += day[x].v; vwap[x] = vv > 0 ? pv / vv : day[x].c; } }
  const atr = new Array(n).fill(null); { let prev; for (let x = 0; x < n; x++) { const tr = x === 0 ? day[0].h - day[0].l : Math.max(day[x].h - day[x].l, Math.abs(day[x].h - day[x - 1].c), Math.abs(day[x].l - day[x - 1].c)); prev = x < ATRL ? (x === 0 ? tr : (prev * x + tr) / (x + 1)) : (prev * (ATRL - 1) + tr) / ATRL; atr[x] = prev; } }
  const priorHigh = (i) => { let h = -Infinity; for (let k = Math.max(0, i - BRK); k < i; k++) h = Math.max(h, day[k].h); return h; };

  let i = WARMUP;
  while (i < n - 2) {
    const disp = day[i].c > priorHigh(i) && day[i].c > day[i].o && (day[i].c - priorHigh(i)) >= DISP * atr[i] && day[i].c > vwap[i];
    if (!disp) { i++; continue; }
    let obIdx = -1;
    for (let k = i - 1; k >= Math.max(0, i - BRK); k--) { if (day[k].c < day[k].o) { obIdx = k; break; } }
    if (obIdx < 0) { i++; continue; }
    const obHigh = day[obIdx].h, obLow = day[obIdx].l;
    let filled = -1, dead = false;
    for (let j = i + 1; j < n - 1; j++) {
      if (day[j].c < obLow) { dead = true; i = j + 1; break; }        // closed below block = invalidated, hunt next
      if (day[j].l <= obHigh) { filled = j + 1; break; }              // retraced into block, held -> fill next open
    }
    if (dead) continue;
    if (filled < 0) return null;                                       // never retraced -> no trade
    const entry = day[filled].o, stop = obLow, risk = entry - stop;
    if (risk <= 0) { i = filled; continue; }
    const target = entry + TGT_R * risk;
    for (let e = filled; e < n; e++) {
      if (day[e].l <= stop) return (stop - entry) / entry - COST;      // stopped (conservative: stop before target)
      if (day[e].h >= target) return (target - entry) / entry - COST;  // target hit
    }
    return (day[n - 1].c - entry) / entry - COST;                       // EOD
  }
  return null;
}

const rets = [], traded = [];
for (const rd of runnerDays) {
  const raw = intr.get(rd.s); if (!raw) continue;
  const OPEN = `${rd.date}T13:30:00Z`, CLOSE = `${rd.date}T20:00:00Z`;
  const day = sortB(raw).filter((x) => x.t >= OPEN && x.t <= CLOSE);
  if (day.length < BRK + 5) continue;
  const r = obTrade(day);
  rets.push(r == null ? 0 : r);
  if (r != null) traded.push(r);
}

const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const pf = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;
console.log(`OPPORTUNITIES: ${rets.length}  ·  OB fired on ${traded.length}  ·  stood aside ${rets.length - traded.length}  (${(100 * traded.length / rets.length).toFixed(0)}% participation)`);
if (traded.length) {
  const w = traded.filter((x) => x > 0), l = traded.filter((x) => x <= 0);
  const PF = Math.abs(l.reduce((s, x) => s + x, 0)) > 0 ? w.reduce((s, x) => s + x, 0) / Math.abs(l.reduce((s, x) => s + x, 0)) : Infinity;
  console.log(`── When it fired:  avg ${pf(mean(traded))}   median ${pf(median(traded))}   green ${(100 * w.length / traded.length).toFixed(0)}%   PF ${PF.toFixed(2)}`);
}
console.log(`── Per OPPORTUNITY (stand-aside = 0):  avg ${pf(mean(rets))}   vs blind −2.32% · VWAP-hold −1.68% · RS-rank1 +0.54%(OOS)`);
console.log("");
