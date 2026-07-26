// Metric pack + routing tree. All indicators use COMPLETED bars only (Donchian/52w
// bands look back over [L-n .. L-1]) so the signal never peeks at the forming bar.
import { THRESH, LANES } from "./config.mjs";

// ---- indicator helpers -------------------------------------------------------
const sma = (a, len, i) => {
  if (i < len - 1) return null;
  let s = 0; for (let k = i - len + 1; k <= i; k++) s += a[k];
  return s / len;
};

function emaSeries(a, len) {
  const out = new Array(a.length).fill(null);
  const alpha = 2 / (len + 1);
  let prev;
  for (let i = len - 1; i < a.length; i++) {
    prev = i === len - 1 ? sma(a, len, i) : alpha * a[i] + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

// Wilder RMA (used for ATR)
function rmaSeries(a, len) {
  const out = new Array(a.length).fill(null);
  let prev;
  for (let i = len - 1; i < a.length; i++) {
    if (i === len - 1) { let s = 0; for (let k = 0; k < len; k++) s += a[k]; prev = s / len; }
    else prev = (prev * (len - 1) + a[i]) / len;
    out[i] = prev;
  }
  return out;
}

// Wilder ADX (standard: DM/TR smoothed, DX, then ADX = Wilder-avg of DX)
function adxSeries(h, l, c, len) {
  const n = h.length, tr = new Array(n), pdm = new Array(n), mdm = new Array(n);
  tr[0] = h[0] - l[0]; pdm[0] = 0; mdm[0] = 0;
  for (let i = 1; i < n; i++) {
    const up = h[i] - h[i - 1], dn = l[i - 1] - l[i];
    pdm[i] = up > dn && up > 0 ? up : 0;
    mdm[i] = dn > up && dn > 0 ? dn : 0;
    tr[i] = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
  }
  const str = new Array(n).fill(null), sp = new Array(n).fill(null), sm = new Array(n).fill(null);
  let t = 0, p = 0, m = 0;
  for (let i = 1; i <= len; i++) { t += tr[i]; p += pdm[i]; m += mdm[i]; }
  if (len >= n) return new Array(n).fill(null);
  str[len] = t; sp[len] = p; sm[len] = m;
  for (let i = len + 1; i < n; i++) {
    str[i] = str[i - 1] - str[i - 1] / len + tr[i];
    sp[i] = sp[i - 1] - sp[i - 1] / len + pdm[i];
    sm[i] = sm[i - 1] - sm[i - 1] / len + mdm[i];
  }
  const dx = new Array(n).fill(null);
  for (let i = len; i < n; i++) {
    const pdi = 100 * sp[i] / str[i], mdi = 100 * sm[i] / str[i], s = pdi + mdi;
    dx[i] = s === 0 ? 0 : 100 * Math.abs(pdi - mdi) / s;
  }
  const adx = new Array(n).fill(null), first = len, last = first + len - 1;
  if (last < n) {
    let seed = 0; for (let i = first; i <= last; i++) seed += dx[i];
    adx[last] = seed / len;
    for (let i = last + 1; i < n; i++) adx[i] = (adx[i - 1] * (len - 1) + dx[i]) / len;
  }
  return adx;
}

// ---- metric pack -------------------------------------------------------------
export function metricPack(rawBars) {
  const bars = [...rawBars].sort((a, b) => (a.t < b.t ? -1 : 1));
  const h = bars.map((b) => b.h), l = bars.map((b) => b.l), c = bars.map((b) => b.c), v = bars.map((b) => b.v);
  const L = bars.length - 1;
  const { donchN, emaTrend, smaRegime, momN, hi52N, atrN, adxN, volN } = THRESH;
  const priorHigh = (arr, n) => { if (L - n < 0) return null; let mx = -Infinity; for (let k = L - n; k <= L - 1; k++) mx = Math.max(mx, arr[k]); return mx; };
  const close = c[L];
  const donHigh = priorHigh(h, donchN);
  const ema = emaSeries(c, emaTrend);
  const trArr = c.map((_, i) => (i === 0 ? h[0] - l[0] : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]))));
  const atr = rmaSeries(trArr, atrN)[L];
  const hi52 = priorHigh(h, hi52N);
  const avgVol20 = sma(v, volN, L);
  return {
    date: bars[L].t.slice(0, 10),
    close,
    pctVs20dHigh: donHigh != null ? (close - donHigh) / donHigh * 100 : null,
    ema50: ema[L], ema50Prev: ema[L - 1],
    sma200: sma(c, smaRegime, L),
    atrPct: atr != null ? atr / close * 100 : null,
    adx: adxSeries(h, l, c, adxN)[L],
    mom3m: L - momN >= 0 ? (close - c[L - momN]) / c[L - momN] * 100 : null,
    pctVs52: hi52 != null ? (close - hi52) / hi52 * 100 : null,
    avgVol20,
    dollarVolM: avgVol20 != null ? avgVol20 * close / 1e6 : null,
  };
}

// ---- routing tree (the "why picks the strategy") -----------------------------
const r0 = (v) => (v == null ? "–" : Math.round(v));
const r1 = (v) => (v == null ? "–" : v.toFixed(1));
const fmtM = (v) => (v == null ? "–" : Math.round(v).toLocaleString());

export function route(p) {
  const { minDollarVolM, minPrice, coilBandPct, adxRange } = THRESH;
  const lane = (name, signal, reason) => ({ strategy: name, code: LANES[name].code, status: LANES[name].status, signal, reason });

  if (p.dollarVolM == null || p.dollarVolM < minDollarVolM || p.close < minPrice)
    return lane("Cash", "illiquid", `$vol ${fmtM(p.dollarVolM)}M / px $${p.close?.toFixed(2)}`);

  const trendUp = p.ema50 != null && p.ema50Prev != null && p.close > p.ema50 && p.ema50 > p.ema50Prev;
  const regimeUp = p.sma200 != null && p.close > p.sma200;
  const breakout = p.pctVs20dHigh != null && p.pctVs20dHigh > 0;

  if (trendUp && regimeUp && breakout)
    return lane("TrendRider", "breakout", `new 20d high +${p.pctVs20dHigh.toFixed(2)}% · ADX ${r0(p.adx)} · ATR ${r1(p.atrPct)}%`);
  if (trendUp && regimeUp && p.pctVs20dHigh != null && p.pctVs20dHigh >= -coilBandPct)
    return lane("TrendRider", "coil", `${p.pctVs20dHigh.toFixed(2)}% from 20d high · uptrend · ADX ${r0(p.adx)}`);
  if (p.adx != null && p.adx < adxRange && regimeUp)
    return lane("MeanRev", "range", `low ADX ${r0(p.adx)} + above 200SMA — chop/range candidate, UNVALIDATED`);

  const why = trendUp
    ? `uptrend but ${p.pctVs20dHigh != null ? p.pctVs20dHigh.toFixed(1) + "% off high" : "far"}`
    : `no clean trend (ADX ${r0(p.adx)}, trendUp 0)`;
  return lane("Cash", "—", why);
}

// Premarket overlay (Phase 3). Runs alongside the swing route — a name can be both a
// swing coil AND a premarket gapper. gap% = (price - prior close)/prior close.
// Momentum/JumpDay are PAPER (unvalidated) until class_backtest.mjs promotes them.
export function routePremarket(pm, swingPack) {
  const { minPrice, minDollarVolM, gapMomentum, gapJump, volSurgeMin } = THRESH;
  if (!pm) return { lane: "—", gapPct: null, note: "no snapshot" };
  const g = pm.gapPct;
  if (pm.price < minPrice || (swingPack?.dollarVolM ?? 1e9) < minDollarVolM)
    return { lane: "—", gapPct: g, note: "illiquid" };
  const surge = pm.volSurge != null && pm.volSurge >= volSurgeMin ? ` · volx ${pm.volSurge.toFixed(1)}` : "";
  if (Math.abs(g) >= gapJump)
    return { lane: "JumpDay", code: LANES.JumpDay.code, status: "PAPER", gapPct: g, note: `jump ${g.toFixed(1)}%${surge}` };
  if (g >= gapMomentum)
    return { lane: "Momentum", code: LANES.Momentum.code, status: "PAPER", gapPct: g, note: `gap +${g.toFixed(1)}%${surge}` };
  return { lane: "—", gapPct: g, note: `gap ${g.toFixed(1)}%` };
}
