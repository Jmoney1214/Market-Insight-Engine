// MULTIPLE-TRADES-PER-DAY scalp test on the penny-runner universe, 1-minute, long-only.
// Per runner-day, RE-ENTER after every exit (many trades/day). BUY = new BRK-bar high +
// close>VWAP + RVOL>=min; SELL = close<EMA9 or ATR*mult stop; flat 15:55. No look-ahead,
// holdout-capable, realistic cost (the killer for penny scalps). NO shorting.
//   node --env-file=.env tools/router/penny_scalp_test.mjs [--from --to --pct --max --dvol --cost]
import { alpacaBars } from "../research/lib/data.mjs";
const FMP = process.env.FMP_API_KEY;
if (!process.env.ALPACA_API_KEY_ID || !process.env.ALPACA_API_SECRET_KEY) throw new Error("missing ALPACA creds");
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const FROM = arg("from", "2026-06-15"), TO = arg("to", "2026-07-28");
const GAP = Number(arg("pct", 20)) / 100, MINP = 1, MAXP = Number(arg("max", 10)), MIN_DVOL = Number(arg("dvol", 20)) * 1e6, COST = Number(arg("cost", 0.5)) / 100;
const BRK = 10, RVOL_MIN = 1.5, EMA_LEN = 9, ATR_LEN = 14, STOP_MULT = 1.5;
const ER_MIN = Number(arg("er", 0)), ER_LEN = Number(arg("erlen", 20));  // trend gate: efficiency ratio over ER_LEN bars >= ER_MIN (0 = off)

const u = new URL("https://financialmodelingprep.com/stable/company-screener");
Object.entries({ priceLowerThan: MAXP, priceMoreThan: MINP, exchange: "NASDAQ,NYSE,AMEX",
  isEtf: false, isFund: false, isActivelyTrading: true, limit: 5000, apikey: FMP })
  .forEach(([k, v]) => u.searchParams.set(k, v));
const rr = await fetch(u); if (!rr.ok) throw new Error(`FMP screener ${rr.status}`);
const syms = (await rr.json()).filter((x) => /^[A-Z]{1,5}$/.test(x.symbol)).map((x) => x.symbol);
const sortB = (r) => [...r].sort((a, b) => (a.t < b.t ? -1 : 1));

console.log(`\n=== MULTI-TRADE SCALP (1min, long-only) · sub-$${MAXP} gap>=${GAP * 100}% · ${FROM}..${TO} · cost ${COST * 100}%/trip ===`);
const daily = await alpacaBars(syms, "1Day", FROM, TO, "scalp_1d", 24);
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
console.log(`${runnerDays.length} runner-days · ${names.length} names · pulling 1-min (this is the slow part)...\n`);
const intr = await alpacaBars(names, "1Min", FROM, TO, "scalp_1m", 24);

function scalpDay(day) {
  const n = day.length; if (n < BRK + 5) return [];
  const vwap = new Array(n); { let pv = 0, vv = 0; for (let i = 0; i < n; i++) { pv += (day[i].h + day[i].l + day[i].c) / 3 * day[i].v; vv += day[i].v; vwap[i] = vv > 0 ? pv / vv : day[i].c; } }
  const ema = new Array(n); { const k = 2 / (EMA_LEN + 1); let e = day[0].c; for (let i = 0; i < n; i++) { e = i === 0 ? day[0].c : day[i].c * k + e * (1 - k); ema[i] = e; } }
  const atr = new Array(n).fill(null); { let pr; for (let i = 0; i < n; i++) { const tr = i === 0 ? day[0].h - day[0].l : Math.max(day[i].h - day[i].l, Math.abs(day[i].h - day[i - 1].c), Math.abs(day[i].l - day[i - 1].c)); pr = i < ATR_LEN ? (i === 0 ? tr : (pr * i + tr) / (i + 1)) : (pr * (ATR_LEN - 1) + tr) / ATR_LEN; atr[i] = pr; } }
  const rvol = (i) => { const lo = Math.max(0, i - 20); let s = 0, c = 0; for (let k = lo; k < i; k++) { s += day[k].v; c++; } const a = c ? s / c : 0; return a > 0 ? day[i].v / a : 0; };
  const ph = (i) => { let h = -Infinity; for (let k = Math.max(0, i - BRK); k < i; k++) h = Math.max(h, day[k].h); return h; };
  const er = (i) => { if (i < ER_LEN) return 0; const net = Math.abs(day[i].c - day[i - ER_LEN].c); let path = 0; for (let k = i - ER_LEN + 1; k <= i; k++) path += Math.abs(day[k].c - day[k - 1].c); return path > 0 ? net / path : 0; };
  const et = (b) => { const h = +b.t.slice(11, 13), m = +b.t.slice(14, 16); return (h - 4) * 60 + m; };  // EDT min-of-day
  const trades = []; let pos = null;
  for (let i = BRK; i < n; i++) {
    if (!pos) {
      if (et(day[i]) >= 575 && et(day[i]) < 955 && day[i].c > ph(i) && day[i].c > vwap[i] && rvol(i) >= RVOL_MIN && er(i) >= ER_MIN && i + 1 < n)
        pos = { entry: day[i + 1].o, stop: day[i].c - STOP_MULT * (atr[i] || 0), ei: i + 1 };
    } else {
      const flat = et(day[i]) >= 955;
      if (day[i].l <= pos.stop) { trades.push((pos.stop - pos.entry) / pos.entry - COST); pos = null; }
      else if (day[i].c < ema[i] || flat) { const ex = i + 1 < n ? day[i + 1].o : day[i].c; trades.push((ex - pos.entry) / pos.entry - COST); pos = null; }
    }
  }
  if (pos) trades.push((day[n - 1].c - pos.entry) / pos.entry - COST);
  return trades;
}

let all = [], daysTraded = 0;
for (const rd of runnerDays) {
  const raw = intr.get(rd.s); if (!raw) continue;
  const day = sortB(raw).filter((x) => x.t.slice(0, 10) === rd.date && x.t.slice(11, 19) >= "13:30:00" && x.t.slice(11, 19) <= "20:00:00");
  const t = scalpDay(day);
  if (t.length) daysTraded++;
  all.push(...t);
}
const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const pf = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;
const w = all.filter((x) => x > 0), l = all.filter((x) => x <= 0);
const PF = Math.abs(l.reduce((s, x) => s + x, 0)) > 0 ? w.reduce((s, x) => s + x, 0) / Math.abs(l.reduce((s, x) => s + x, 0)) : Infinity;
console.log(`TRADES: ${all.length}  ·  over ${daysTraded} runner-days = ${(all.length / (daysTraded || 1)).toFixed(1)} trades/name-day`);
console.log(`  avg/trade ${pf(mean(all))}  ·  win ${(100 * w.length / (all.length || 1)).toFixed(0)}%  ·  PF ${PF.toFixed(2)}  ·  sum ${pf(all.reduce((s, x) => s + x, 0))} (if you took EVERY trade, 1 unit each)`);
console.log("");
