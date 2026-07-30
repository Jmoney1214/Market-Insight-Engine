// FINAL long-only test: the Penny Runner Scalper's EXACT ignition rule.
// Entry (armed runner day only): a bar that makes a NEW brkLen-bar HIGH *and* has
// RVOL >= surge *and* closes ABOVE VWAP. Exit = trail on the fast EMA (close < EMA9)
// or initial ATR hard-stop or EOD — the tool's own design. Long-only, next-bar fills,
// net of cost. Compares to the -2.32% blind-buy base rate and the VWAP-hold rejects.
//   node --env-file=.env tools/router/penny_ignite.mjs
import { alpacaBars } from "../research/lib/data.mjs";

const FMP = process.env.FMP_API_KEY;
if (!process.env.ALPACA_API_KEY_ID || !process.env.ALPACA_API_SECRET_KEY) throw new Error("missing ALPACA creds");
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const FROM = arg("from", "2026-04-01"), TO = "2026-07-28";
const GAP = Number(arg("pct", 20)) / 100, MINP = 0.30, MAXP = 10, MIN_DVOL = 20e6, COST = 0.005;
// Pine defaults
const RVOL_LEN = 20, RVOL_SURGE = Number(arg("rvol", 3)), BRK = 20, EMA_LEN = 9, ATR_LEN = 14, ATR_MULT = 1.5, WARMUP = 3;

const u = new URL("https://financialmodelingprep.com/stable/company-screener");
Object.entries({ priceLowerThan: MAXP, priceMoreThan: MINP, exchange: "NASDAQ,NYSE,AMEX",
  isEtf: false, isFund: false, isActivelyTrading: true, limit: 5000, apikey: FMP })
  .forEach(([k, v]) => u.searchParams.set(k, v));
const rr = await fetch(u); if (!rr.ok) throw new Error(`FMP screener ${rr.status}`);
const syms = (await rr.json()).filter((x) => /^[A-Z]{1,5}$/.test(x.symbol)).map((x) => x.symbol);
const sortB = (raw) => [...raw].sort((a, b) => (a.t < b.t ? -1 : 1));

console.log(`\n=== IGNITE (new high + RVOL>=${RVOL_SURGE}x + above VWAP, LONG-ONLY, EMA${EMA_LEN} trail) · ${FROM}..${TO} · gap>=${GAP * 100}% ===`);
const daily = await alpacaBars(syms, "1Day", FROM, TO, "vwap_hold_daily", 24);  // reuse cache
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
const intr = await alpacaBars(names, "5Min", FROM, TO, "vwap_hold_5m", 24);  // reuse cache

function igniteTrade(day) {
  const n = day.length;
  // rolling series
  const vwap = new Array(n); { let pv = 0, vv = 0; for (let i = 0; i < n; i++) { pv += (day[i].h + day[i].l + day[i].c) / 3 * day[i].v; vv += day[i].v; vwap[i] = vv > 0 ? pv / vv : day[i].c; } }
  const ema = new Array(n); { const k = 2 / (EMA_LEN + 1); let e = day[0].c; for (let i = 0; i < n; i++) { e = i === 0 ? day[0].c : day[i].c * k + e * (1 - k); ema[i] = e; } }
  const atr = new Array(n).fill(null); { let tr0 = day[0].h - day[0].l, prev; for (let i = 0; i < n; i++) { const tr = i === 0 ? tr0 : Math.max(day[i].h - day[i].l, Math.abs(day[i].h - day[i - 1].c), Math.abs(day[i].l - day[i - 1].c)); if (i < ATR_LEN) { prev = i === 0 ? tr : (prev * i + tr) / (i + 1); } else { prev = (prev * (ATR_LEN - 1) + tr) / ATR_LEN; } atr[i] = prev; } }
  const rvolAt = (i) => { const lo = Math.max(0, i - RVOL_LEN); let s = 0, c = 0; for (let k = lo; k < i; k++) { s += day[k].v; c++; } const avg = c ? s / c : 0; return avg > 0 ? day[i].v / avg : 0; };
  const priorHigh = (i) => { let h = -Infinity; for (let k = Math.max(0, i - BRK); k < i; k++) h = Math.max(h, day[k].h); return h; };

  let igIdx = -1;
  for (let i = WARMUP; i < n - 1; i++) {
    if (day[i].c > vwap[i] && rvolAt(i) >= RVOL_SURGE && day[i].h > priorHigh(i)) { igIdx = i; break; }
  }
  if (igIdx < 0 || igIdx + 1 >= n) return null;                 // no ignition -> stand aside
  const entryIdx = igIdx + 1, entry = day[entryIdx].o;
  const hardStop = Math.min(day[igIdx].l, day[igIdx].c - ATR_MULT * (atr[igIdx] || 0));
  for (let j = entryIdx; j < n; j++) {
    if (day[j].l < hardStop) return (hardStop - entry) / entry - COST;     // initial ATR stop hit
    if (day[j].c < ema[j]) { const ex = j + 1 < n ? day[j + 1].o : day[j].c; return (ex - entry) / entry - COST; } // EMA trail
  }
  return (day[n - 1].c - entry) / entry - COST;                 // EOD
}

const rets = [], tradedList = [];
for (const rd of runnerDays) {
  const raw = intr.get(rd.s); if (!raw) continue;
  const OPEN = `${rd.date}T13:30:00Z`, CLOSE = `${rd.date}T20:00:00Z`;
  const day = sortB(raw).filter((x) => x.t >= OPEN && x.t <= CLOSE);
  if (day.length < BRK + 3) continue;
  const r = igniteTrade(day);
  rets.push(r == null ? 0 : r);
  if (r != null) tradedList.push(r);
}

const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const pf = (n) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(2)}%`;
console.log(`OPPORTUNITIES: ${rets.length}  ·  IGNITE fired on ${tradedList.length}  ·  stood aside ${rets.length - tradedList.length}  (${(100 * tradedList.length / rets.length).toFixed(0)}% participation)\n`);
if (tradedList.length) {
  const w = tradedList.filter((x) => x > 0), l = tradedList.filter((x) => x <= 0);
  const PF = Math.abs(l.reduce((s, x) => s + x, 0)) > 0 ? w.reduce((s, x) => s + x, 0) / Math.abs(l.reduce((s, x) => s + x, 0)) : Infinity;
  console.log(`── When IGNITE fired:  avg ${pf(mean(tradedList))}   median ${pf(median(tradedList))}   green ${(100 * w.length / tradedList.length).toFixed(0)}%   PF ${PF.toFixed(2)}`);
}
console.log(`── Per OPPORTUNITY (stand-aside = 0):  avg ${pf(mean(rets))}   vs blind-buy -2.32%, VWAP-hold -1.68%`);
console.log(`\n(net of ${COST * 100}% round-trip cost; sub-$10 fills optimistic → upper bound)\n`);
