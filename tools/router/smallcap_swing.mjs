// SWING (multi-day hold) strategies on $15-and-below — the two VALIDATED edge TYPES
// (trend-following + mean-reversion), never tested in this band. Daily bars, long-only.
//   momentum = buy close>prior-20d-high in uptrend (>EMA50, SPY>200SMA); exit chandelier ATR(22)x3.5.
//   meanrev  = buy RSI2<10 & close>SMA200 & SPY>200SMA; exit close>SMA5 or 10-day stop.
// NOTE: FMP screener = names alive TODAY -> SURVIVORSHIP BIAS (dead tickers excluded) inflates
// results; treat any positive as an OPTIMISTIC upper bound. Holdout tests time, not survivorship.
//   node --env-file=.env tools/router/smallcap_swing.mjs --strat=momentum|meanrev [--from --to]
import { alpacaBars } from "../research/lib/data.mjs";

const FMP = process.env.FMP_API_KEY;
if (!process.env.ALPACA_API_KEY_ID || !process.env.ALPACA_API_SECRET_KEY) throw new Error("missing ALPACA creds");
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const FROM = arg("from", "2024-01-01"), TO = arg("to", "2026-07-28"), STRAT = arg("strat", "momentum");
const MINP = Number(arg("min", 2)), MAXP = Number(arg("max", 15)), MIN_DVOL = Number(arg("dvol", 20)) * 1e6, COST = Number(arg("cost", 0.4)) / 100;

const u = new URL("https://financialmodelingprep.com/stable/company-screener");
Object.entries({ priceLowerThan: MAXP, priceMoreThan: MINP, exchange: "NASDAQ,NYSE,AMEX",
  isEtf: false, isFund: false, isActivelyTrading: true, limit: 5000, apikey: FMP })
  .forEach(([k, v]) => u.searchParams.set(k, v));
const rr = await fetch(u); if (!rr.ok) throw new Error(`FMP screener ${rr.status}`);
const syms = (await rr.json()).filter((x) => /^[A-Z]{1,5}$/.test(x.symbol)).map((x) => x.symbol);
const sortB = (raw) => [...raw].sort((a, b) => (a.t < b.t ? -1 : 1));

console.log(`\n=== SMALL-CAP SWING: ${STRAT.toUpperCase()} (LONG-ONLY) · $${MINP}-$${MAXP} · ${FROM}..${TO} ===`);
const bars = await alpacaBars([...syms, "SPY"], "1Day", FROM, TO, "swing_1d", 24);
const spy = sortB(bars.get("SPY") || []);
const smaAt = (arr, len, i, sel = (x) => x.c) => { if (i < len - 1) return null; let s = 0; for (let k = i - len + 1; k <= i; k++) s += sel(arr[k]); return s / len; };
// SPY 200SMA regime by date
const spyReg = new Map();
for (let i = 0; i < spy.length; i++) { const s = smaAt(spy, 200, i); spyReg.set(spy[i].t.slice(0, 10), s != null && spy[i].c > s); }

function atrSeries(b, len) {
  const n = b.length, out = new Array(n).fill(null); let prev;
  for (let i = 0; i < n; i++) { const tr = i === 0 ? (b[0].h - b[0].l) : Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c)); prev = i < len ? (i === 0 ? tr : (prev * i + tr) / (i + 1)) : (prev * (len - 1) + tr) / len; out[i] = prev; }
  return out;
}
function rsiSeries(b, len) {
  const n = b.length, out = new Array(n).fill(null); let ag = 0, al = 0;
  for (let i = 1; i < n; i++) { const ch = b[i].c - b[i - 1].c, g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= len) { ag += g; al += l; if (i === len) { ag /= len; al /= len; out[i] = 100 - 100 / (1 + (al === 0 ? 100 : ag / al)); } } else { ag = (ag * (len - 1) + g) / len; al = (al * (len - 1) + l) / len; out[i] = 100 - 100 / (1 + (al === 0 ? 100 : ag / al)); } }
  return out;
}

const trades = [];
for (const s of syms) {
  const raw = bars.get(s); if (!raw || raw.length < 220) continue;
  const b = sortB(raw), n = b.length;
  const atr = atrSeries(b, 22), rsi2 = rsiSeries(b, 2);
  let inPos = false, entry = 0, entryIdx = 0, hh = 0, stop = 0;
  for (let i = 210; i < n - 1; i++) {
    const price = b[i].c, dvol = price * (b.slice(Math.max(0, i - 19), i + 1).reduce((x, y) => x + (y.v || 0), 0) / 20);
    if (price < MINP || price > MAXP || dvol < MIN_DVOL) { continue; }
    const sma200 = smaAt(b, 200, i), sma50 = smaAt(b, 50, i), sma5 = smaAt(b, 5, i);
    const hi20 = Math.max(...b.slice(i - 20, i).map((x) => x.h));
    const reg = spyReg.get(b[i].t.slice(0, 10)) === true;

    if (!inPos) {
      let sig = false;
      if (STRAT === "momentum") sig = sma50 != null && price > hi20 && price > sma50 && reg;
      else sig = rsi2[i] != null && rsi2[i] < 10 && sma200 != null && price > sma200 && reg;
      if (sig) { inPos = true; entryIdx = i + 1; entry = b[i + 1].o; hh = b[i + 1].h; stop = STRAT === "momentum" ? entry - 3.5 * atr[i] : entry - 2.5 * atr[i]; }
    } else {
      hh = Math.max(hh, b[i].h);
      let exit = false;
      if (STRAT === "momentum") { stop = Math.max(stop, hh - 3.5 * atr[i]); if (b[i].c < stop) exit = true; }
      else { const held = i - entryIdx; if ((sma5 != null && b[i].c > sma5) || held >= 10 || b[i].c < stop) exit = true; }
      if (exit) { const ex = b[i + 1].o; trades.push((ex - entry) / entry - COST); inPos = false; }
    }
  }
}

const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const pf = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;
const w = trades.filter((x) => x > 0), l = trades.filter((x) => x <= 0);
const PF = Math.abs(l.reduce((s, x) => s + x, 0)) > 0 ? w.reduce((s, x) => s + x, 0) / Math.abs(l.reduce((s, x) => s + x, 0)) : Infinity;
console.log(`TRADES: ${trades.length}  ·  avg ${pf(mean(trades))}  ·  median ${pf(median(trades))}  ·  win ${(100 * w.length / (trades.length || 1)).toFixed(0)}%  ·  PF ${PF.toFixed(2)}`);
console.log(`(net of ${COST * 100}% round-trip; ⚠️ survivorship-inflated — optimistic upper bound)\n`);
