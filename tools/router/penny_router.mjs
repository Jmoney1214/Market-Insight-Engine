// MATCHED ROUTER (Strategy Router for penny runners), 1-min, long-only, NO look-ahead.
// Classify each runner-day's pattern from ONLY the first hour (9:30-10:30 ET), then route:
//   TREND (directional up) -> MOMENTUM ride;  CHOP (oscillating) -> MEAN-REVERSION;  FADE -> skip.
// Trades happen ONLY after 10:30 (classifier is blind to the rest of the day). Holdout-capable.
//   node --env-file=.env tools/router/penny_router.mjs [--from --to --max --pct --dvol --cost]
import { alpacaBars } from "../research/lib/data.mjs";
const FMP = process.env.FMP_API_KEY;
if (!process.env.ALPACA_API_KEY_ID || !process.env.ALPACA_API_SECRET_KEY) throw new Error("missing ALPACA creds");
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const FROM = arg("from", "2026-06-15"), TO = arg("to", "2026-07-28");
const GAP = Number(arg("pct", 20)) / 100, MINP = 1, MAXP = Number(arg("max", 10)), MIN_DVOL = Number(arg("dvol", 20)) * 1e6, COST = Number(arg("cost", 0.5)) / 100;
const BRK = 10, RVOL_MIN = 1.5, EMA_LEN = 9, ATR_LEN = 14, STOP_MULT = 1.5;
const TREND_ER = Number(arg("ter", 0.45)), TREND_NET = Number(arg("tnet", 0.02)), FADE_NET = Number(arg("fnet", -0.02));  // classifier thresholds (open-hour)

const u = new URL("https://financialmodelingprep.com/stable/company-screener");
Object.entries({ priceLowerThan: MAXP, priceMoreThan: MINP, exchange: "NASDAQ,NYSE,AMEX",
  isEtf: false, isFund: false, isActivelyTrading: true, limit: 5000, apikey: FMP })
  .forEach(([k, v]) => u.searchParams.set(k, v));
const rr = await fetch(u); if (!rr.ok) throw new Error(`FMP screener ${rr.status}`);
const syms = (await rr.json()).filter((x) => /^[A-Z]{1,5}$/.test(x.symbol)).map((x) => x.symbol);
const sortB = (r) => [...r].sort((a, b) => (a.t < b.t ? -1 : 1));
const etMin = (b) => { const h = +b.t.slice(11, 13), m = +b.t.slice(14, 16); return (h - 4) * 60 + m; };  // EDT

console.log(`\n=== MATCHED ROUTER (1min, long-only) · sub-$${MAXP} gap>=${GAP * 100}% · ${FROM}..${TO} · cost ${COST * 100}% ===`);
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

function series(day) {
  const n = day.length;
  const vwap = new Array(n); { let pv = 0, vv = 0; for (let i = 0; i < n; i++) { pv += (day[i].h + day[i].l + day[i].c) / 3 * day[i].v; vv += day[i].v; vwap[i] = vv > 0 ? pv / vv : day[i].c; } }
  const ema = new Array(n); { const k = 2 / (EMA_LEN + 1); let e = day[0].c; for (let i = 0; i < n; i++) { e = i === 0 ? day[0].c : day[i].c * k + e * (1 - k); ema[i] = e; } }
  const atr = new Array(n).fill(null); { let pr; for (let i = 0; i < n; i++) { const tr = i === 0 ? day[0].h - day[0].l : Math.max(day[i].h - day[i].l, Math.abs(day[i].h - day[i - 1].c), Math.abs(day[i].l - day[i - 1].c)); pr = i < ATR_LEN ? (i === 0 ? tr : (pr * i + tr) / (i + 1)) : (pr * (ATR_LEN - 1) + tr) / ATR_LEN; atr[i] = pr; } }
  return { vwap, ema, atr };
}
const rvolAt = (day, i) => { const lo = Math.max(0, i - 20); let s = 0, c = 0; for (let k = lo; k < i; k++) { s += day[k].v; c++; } const a = c ? s / c : 0; return a > 0 ? day[i].v / a : 0; };
const phAt = (day, i) => { let h = -Infinity; for (let k = Math.max(0, i - BRK); k < i; k++) h = Math.max(h, day[k].h); return h; };

// classify from the OPEN HOUR only (bars with et in [570,630))
function classify(day) {
  const ow = day.filter((b) => etMin(b) >= 570 && etMin(b) < 630);
  if (ow.length < 15) return "SKIP";
  const net = (ow[ow.length - 1].c - ow[0].o) / ow[0].o;
  let path = 0; for (let k = 1; k < ow.length; k++) path += Math.abs(ow[k].c - ow[k - 1].c);
  const er = path > 0 ? Math.abs(ow[ow.length - 1].c - ow[0].c) / path : 0;
  if (net < FADE_NET) return "FADE";
  if (er >= TREND_ER && net > TREND_NET) return "TREND";
  return "CHOP";
}
// MOMENTUM (trend): breakout ride, multi-entry, EMA9 / ATR-stop exit
function momentum(day, s, start) {
  const { vwap, ema, atr } = s; const n = day.length, tr = []; let pos = null;
  for (let i = Math.max(BRK, start); i < n; i++) {
    if (!pos) { if (etMin(day[i]) >= 630 && etMin(day[i]) < 955 && day[i].c > phAt(day, i) && day[i].c > vwap[i] && rvolAt(day, i) >= RVOL_MIN && i + 1 < n) pos = { e: day[i + 1].o, stop: day[i].c - STOP_MULT * (atr[i] || 0) }; }
    else { const flat = etMin(day[i]) >= 955; if (day[i].l <= pos.stop) { tr.push((pos.stop - pos.e) / pos.e - COST); pos = null; } else if (day[i].c < ema[i] || flat) { const x = i + 1 < n ? day[i + 1].o : day[i].c; tr.push((x - pos.e) / pos.e - COST); pos = null; } }
  }
  if (pos) tr.push((day[n - 1].c - pos.e) / pos.e - COST);
  return tr;
}
// MEAN-REVERSION (chop): buy the dip below VWAP that ticks up, sell back at the mean (VWAP), ATR stop
function meanrev(day, s, start) {
  const { vwap, atr } = s; const n = day.length, tr = []; let pos = null;
  for (let i = Math.max(2, start); i < n; i++) {
    if (!pos) { if (etMin(day[i]) >= 630 && etMin(day[i]) < 955 && day[i].c < vwap[i] && day[i].c > day[i - 1].c && i + 1 < n) pos = { e: day[i + 1].o, stop: day[i].l - STOP_MULT * (atr[i] || 0), vt: vwap[i] }; }
    else { const flat = etMin(day[i]) >= 955; if (day[i].l <= pos.stop) { tr.push((pos.stop - pos.e) / pos.e - COST); pos = null; } else if (day[i].c >= vwap[i] || flat) { const x = i + 1 < n ? day[i + 1].o : day[i].c; tr.push((x - pos.e) / pos.e - COST); pos = null; } }
  }
  if (pos) tr.push((day[n - 1].c - pos.e) / pos.e - COST);
  return tr;
}

const byClass = { TREND: [], CHOP: [], FADE: [], SKIP: [] }; const nClass = { TREND: 0, CHOP: 0, FADE: 0, SKIP: 0 };
for (const rd of runnerDays) {
  const raw = intr.get(rd.s); if (!raw) continue;
  const day = sortB(raw).filter((x) => x.t.slice(0, 10) === rd.date && x.t.slice(11, 19) >= "13:30:00" && x.t.slice(11, 19) <= "20:00:00");
  if (day.length < 60) continue;
  const cls = classify(day); nClass[cls]++;
  const s = series(day); const start = day.findIndex((b) => etMin(b) >= 630);
  const tr = cls === "TREND" ? momentum(day, s, start) : cls === "CHOP" ? meanrev(day, s, start) : [];
  byClass[cls].push(...tr);
}
const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const pf = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;
const stat = (a) => { const w = a.filter((x) => x > 0), l = a.filter((x) => x <= 0); const P = Math.abs(l.reduce((s, x) => s + x, 0)) > 0 ? w.reduce((s, x) => s + x, 0) / Math.abs(l.reduce((s, x) => s + x, 0)) : Infinity; return `${a.length} tr · avg ${pf(mean(a))} · win ${(100 * w.length / (a.length || 1)).toFixed(0)}% · PF ${P.toFixed(2)}`; };
console.log(`Days: TREND ${nClass.TREND} · CHOP ${nClass.CHOP} · FADE ${nClass.FADE} (skipped) · unclassifiable ${nClass.SKIP}\n`);
console.log(`  TREND->momentum:  ${stat(byClass.TREND)}`);
console.log(`  CHOP ->meanrev:   ${stat(byClass.CHOP)}`);
const allTr = [...byClass.TREND, ...byClass.CHOP];
console.log(`  ─────`);
console.log(`  ROUTED TOTAL:     ${stat(allTr)}`);
console.log("");
