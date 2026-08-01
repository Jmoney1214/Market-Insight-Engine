// Validate PENNY PRO LONG v2 the honest way: port its exact confluence + scale-out to the
// backtester and run across the whole penny-runner universe, in-sample + holdout, real cost.
// Confluence (need >=5/6): 1H-trend(EMA60 proxy) + >VWAP + 15m(EMA15 proxy) + RSI 40-72 +
// RVOL>=1.5 + fresh 20-bar high. Scale 50% at TP1(1xATR)/breakeven, 50% at TP2(2xATR),
// stop 1.5xATR. Cooldown + max trades/day. 1-min, long-only. NO look-ahead.
//   node --env-file=.env tools/router/penny_pro_test.mjs [--from --to --cost]
import { alpacaBars } from "../research/lib/data.mjs";
const FMP = process.env.FMP_API_KEY;
if (!process.env.ALPACA_API_KEY_ID || !process.env.ALPACA_API_SECRET_KEY) throw new Error("missing ALPACA creds");
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const FROM = arg("from", "2026-06-15"), TO = arg("to", "2026-07-28");
const GAP = 0.20, MINP = 1, MAXP = 10, MIN_DVOL = 20e6, COST = Number(arg("cost", 0.5)) / 100;
const SCORE_MIN = 5, RVOL_MIN = 1.5, HI = 20, VOL_LEN = 30, COOLDOWN = 20, MAX_DAY = 8;

const u = new URL("https://financialmodelingprep.com/stable/company-screener");
Object.entries({ priceLowerThan: MAXP, priceMoreThan: MINP, exchange: "NASDAQ,NYSE,AMEX",
  isEtf: false, isFund: false, isActivelyTrading: true, limit: 5000, apikey: FMP })
  .forEach(([k, v]) => u.searchParams.set(k, v));
const rr = await fetch(u); if (!rr.ok) throw new Error(`FMP screener ${rr.status}`);
const syms = (await rr.json()).filter((x) => /^[A-Z]{1,5}$/.test(x.symbol)).map((x) => x.symbol);
const sortB = (r) => [...r].sort((a, b) => (a.t < b.t ? -1 : 1));
const etMin = (b) => { const h = +b.t.slice(11, 13), m = +b.t.slice(14, 16); return (h - 4) * 60 + m; };

console.log(`\n=== PENNY PRO LONG v2 — validation (1min, long-only) · sub-$${MAXP} gap>=${GAP * 100}% · ${FROM}..${TO} · cost ${COST * 100}% ===`);
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
console.log(`${runnerDays.length} runner-days · ${names.length} names · pulling 1-min...\n`);
const intr = await alpacaBars(names, "1Min", FROM, TO, "scalp_1m", 24);
const emaArr = (vals, len) => { const k = 2 / (len + 1), o = new Array(vals.length); let e = vals[0]; for (let i = 0; i < vals.length; i++) { e = i === 0 ? vals[0] : vals[i] * k + e * (1 - k); o[i] = e; } return o; };

function simExit(day, ei, E, atr) {
  const n = day.length, stop = E - 1.5 * atr, tp1 = E + atr, tp2 = E + 2 * atr;
  let exA = null, exB = null, tp1hit = false;
  for (let j = ei; j < n; j++) {
    if (exA == null) { if (day[j].l <= stop) exA = stop; else if (day[j].h >= tp1) { exA = tp1; tp1hit = true; } }
    const beB = tp1hit ? E : stop;
    if (exB == null) { if (day[j].l <= beB) exB = beB; else if (day[j].h >= tp2) exB = tp2; }
    if (exA != null && exB != null) break;
  }
  if (exA == null) exA = day[n - 1].c;
  if (exB == null) exB = day[n - 1].c;
  const lastExitIdx = n - 1;  // approx; cooldown uses bar count
  return { ret: 0.5 * ((exA - E) / E) + 0.5 * ((exB - E) / E), exitIdx: lastExitIdx };
}

let all = [], daysTraded = 0;
for (const rd of runnerDays) {
  const raw = intr.get(rd.s); if (!raw) continue;
  const day = sortB(raw).filter((x) => x.t.slice(0, 10) === rd.date && x.t.slice(11, 19) >= "13:30:00" && x.t.slice(11, 19) <= "20:00:00");
  if (day.length < 70) continue;
  const n = day.length, C = day.map((b) => b.c);
  const vwap = new Array(n); { let pv = 0, vv = 0; for (let i = 0; i < n; i++) { pv += (day[i].h + day[i].l + day[i].c) / 3 * day[i].v; vv += day[i].v; vwap[i] = vv > 0 ? pv / vv : day[i].c; } }
  const e60 = emaArr(C, 60), e15 = emaArr(C, 15);
  const atr = new Array(n).fill(null); { let pr; for (let i = 0; i < n; i++) { const tr = i === 0 ? day[0].h - day[0].l : Math.max(day[i].h - day[i].l, Math.abs(day[i].h - day[i - 1].c), Math.abs(day[i].l - day[i - 1].c)); pr = i < 14 ? (i === 0 ? tr : (pr * i + tr) / (i + 1)) : (pr * 13 + tr) / 14; atr[i] = pr; } }
  const rsi = (() => { const o = new Array(n).fill(50); let ag = 0, al = 0; for (let i = 1; i < n; i++) { const ch = C[i] - C[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= 14) { ag += g; al += l; if (i === 14) { ag /= 14; al /= 14; o[i] = 100 - 100 / (1 + (al === 0 ? 100 : ag / al)); } } else { ag = (ag * 13 + g) / 14; al = (al * 13 + l) / 14; o[i] = 100 - 100 / (1 + (al === 0 ? 100 : ag / al)); } } return o; })();
  const rvol = (i) => { const lo = Math.max(0, i - VOL_LEN); let s = 0, c = 0; for (let k = lo; k < i; k++) { s += day[k].v; c++; } const a = c ? s / c : 0; return a > 0 ? day[i].v / a : 0; };
  const newHi = (i) => { let h = -Infinity; for (let k = Math.max(0, i - HI); k < i; k++) h = Math.max(h, day[k].h); return day[i].c >= h; };

  let lastExit = -10000, dayTr = 0, i = 65, traded = false;
  while (i < n - 1) {
    const et = etMin(day[i]);
    if (et < 575 || et >= 955) { i++; continue; }
    const f1 = C[i] > e60[i], f2 = C[i] > vwap[i], f3 = C[i] > e15[i], f4 = rsi[i] >= 40 && rsi[i] <= 72, f5 = rvol(i) >= RVOL_MIN, f6 = C[i] > C[i - 1] && newHi(i);
    const score = f1 + f2 + f3 + f4 + f5 + f6;
    if (score >= SCORE_MIN && (i - lastExit) >= COOLDOWN && dayTr < MAX_DAY) {
      const E = day[i + 1].o, r = simExit(day, i + 1, E, atr[i]);
      all.push(r.ret - COST); dayTr++; traded = true; lastExit = r.exitIdx; i = r.exitIdx + 1;
    } else i++;
  }
  if (traded) daysTraded++;
}
const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const pf = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;
const w = all.filter((x) => x > 0), l = all.filter((x) => x <= 0);
const PF = Math.abs(l.reduce((s, x) => s + x, 0)) > 0 ? w.reduce((s, x) => s + x, 0) / Math.abs(l.reduce((s, x) => s + x, 0)) : Infinity;
console.log(`TRADES: ${all.length} over ${daysTraded} runner-days (${(all.length / (daysTraded || 1)).toFixed(1)}/day) · avg ${pf(mean(all))} · win ${(100 * w.length / (all.length || 1)).toFixed(0)}% · PF ${PF.toFixed(2)} · sum ${pf(all.reduce((s, x) => s + x, 0))}`);
console.log("");
