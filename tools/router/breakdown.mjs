// Full trade + PnL breakdown for specific dates, using REAL exits (not naive marks):
// TrendRider = chandelier ATR(22)×3.5 trailing stop (matches trend_rider.pine);
// MeanRev = close>SMA5 or mrMaxHold. Entry = next open after the signal close. Writes JSON.
import { alpacaBars, fmpEarnings } from "../research/lib/data.mjs";
import { daysBefore } from "../research/lib/dates.mjs";
import { UNIVERSE, THRESH } from "./config.mjs";
import { metricPack, route } from "./classify.mjs";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DATES = ["2026-06-01", "2026-06-02"];
const COST = 0.0004, CHAND_ATR = 22, CHAND_MULT = 3.5;

const sortB = (raw) => [...raw].sort((a, b) => (a.t < b.t ? -1 : 1));
const idxAsof = (b, d) => { let i = -1; for (let k = 0; k < b.length; k++) { if (b[k].t.slice(0, 10) <= d) i = k; else break; } return i; };
const sma = (b, len, i) => { if (i < len - 1) return null; let s = 0; for (let k = i - len + 1; k <= i; k++) s += b[k].c; return s / len; };
function atrSeries(b, len) {
  const n = b.length, tr = new Array(n); tr[0] = b[0].h - b[0].l;
  for (let i = 1; i < n; i++) tr[i] = Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c));
  const out = new Array(n).fill(null); let prev;
  for (let i = len - 1; i < n; i++) { if (i === len - 1) { let s = 0; for (let k = 0; k < len; k++) s += tr[k]; prev = s / len; } else prev = (prev * (len - 1) + tr[i]) / len; out[i] = prev; }
  return out;
}
function closedOrOpen(b, entryIdx, exitAtE) {
  const entry = b[entryIdx].o;
  for (let e = entryIdx; e < b.length; e++) {
    if (exitAtE(e)) {
      const ni = e + 1 < b.length ? e + 1 : e, exit = e + 1 < b.length ? b[e + 1].o : b[e].c;
      return { status: "closed", entry, exit, retPct: ((exit - entry) / entry - COST) * 100, entryDate: b[entryIdx].t.slice(0, 10), exitDate: b[ni].t.slice(0, 10), heldDays: ni - entryIdx };
    }
  }
  const last = b[b.length - 1];
  return { status: "open", entry, exit: last.c, retPct: ((last.c - entry) / entry) * 100, entryDate: b[entryIdx].t.slice(0, 10), exitDate: last.t.slice(0, 10), heldDays: b.length - 1 - entryIdx };
}
function trendExit(b, entryIdx) {
  if (entryIdx >= b.length) return null;
  const atr = atrSeries(b, CHAND_ATR); let hh = b[entryIdx].h, trail = -Infinity;
  return closedOrOpen(b, entryIdx, (e) => { hh = Math.max(hh, b[e].h); if (atr[e] != null) trail = Math.max(trail, hh - CHAND_MULT * atr[e]); return trail > -Infinity && b[e].c < trail; });
}
function meanExit(b, entryIdx) {
  if (entryIdx >= b.length) return null;
  return closedOrOpen(b, entryIdx, (e) => { const s5 = sma(b, 5, e); return (s5 != null && b[e].c > s5) || (e - entryIdx) >= THRESH.mrMaxHold; });
}

const start = daysBefore(DATES[0], 430), end = "2026-08-31";
const bars = await alpacaBars([...UNIVERSE, "SPY"], "1Day", start, end, "breakdown", 24);
const out = [];
for (const date of DATES) {
  const spyB = sortB(bars.get("SPY")), si = idxAsof(spyB, date);
  const spyPack = metricPack(spyB.slice(0, si + 1)), regimeOK = spyPack.sma200 != null && spyPack.close > spyPack.sma200;
  let bl = new Set();
  try { const earn = await fmpEarnings(date, daysBefore(date, -THRESH.mrEarningsBlackoutDays)); const u = new Set(UNIVERSE); for (const r of earn) { const s = r.slice(r.lastIndexOf("|") + 1); if (u.has(s)) bl.add(s); } } catch {}
  const breakouts = [], meanrev = [];
  for (const sym of UNIVERSE) {
    const raw = bars.get(sym); if (!raw) continue; const b = sortB(raw); const ai = idxAsof(b, date); if (ai < 253) continue;
    const m = metricPack(b.slice(0, ai + 1)); const r = route(m, regimeOK, bl.has(sym));
    if (r.strategy === "TrendRider" && r.signal === "breakout") { const o = trendExit(b, ai + 1); if (o) breakouts.push({ sym, ...o }); }
    else if (r.strategy === "MeanRev") { const o = meanExit(b, ai + 1); if (o) meanrev.push({ sym, rsi2: Math.round(m.rsi2), ...o }); }
  }
  meanrev.sort((a, b) => a.rsi2 - b.rsi2);
  out.push({ date, regimeOK, spyClose: +spyPack.close.toFixed(2), spySma200: +spyPack.sma200.toFixed(2), breakouts, meanrev: meanrev.slice(0, THRESH.mrMaxConcurrent) });
}
const f = fileURLToPath(new URL("./scans/breakdown-june.json", import.meta.url));
writeFileSync(f, JSON.stringify(out, null, 2));
for (const d of out) {
  const all = [...d.breakouts, ...d.meanrev];
  const avg = all.reduce((s, t) => s + t.retPct, 0) / all.length, win = 100 * all.filter((t) => t.retPct > 0).length / all.length;
  console.log(`${d.date} regime ${d.regimeOK ? "ON" : "OFF"}: ${d.breakouts.length} breakout + ${d.meanrev.length} dip = ${all.length} trades · avg ${avg.toFixed(2)}% · win ${win.toFixed(0)}%`);
}
console.log("wrote", f);
