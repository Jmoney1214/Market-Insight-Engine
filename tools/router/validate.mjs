// Strategy Router — Phase 4: PAPER-lane validation harness.
// Backtests a lane's thesis on daily bars over a strict train/holdout split and
// returns PROMOTE (survivor -> LIVE) or HOLD. Only a survivor of the OUT-sample
// holdout is ever promoted — this is the gate between "routed to a PAPER lane"
// and "routed to a LIVE lane that can place real orders". Run:
//   node --env-file=.env tools/router/validate.mjs --lane=momentum [--promote]
//   node --env-file=.env tools/router/validate.mjs --lane=jumpday  [--promote]
//   node --env-file=.env tools/router/validate.mjs --lane=meanrev  [--promote]
// meanrev is a DIFFERENT backtest than the gap lanes (momentum/jumpday): those
// two are same-day gap-continuation tests; meanrev is a multi-day Connors RSI2
// dip-buy (see the backtest section below for the full leak-avoidance writeup).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { alpacaBars, gitSha } from "../research/lib/data.mjs";
import { daysBefore } from "../research/lib/dates.mjs";
import { UNIVERSE, THRESH, LANES } from "./config.mjs";

// The router only ever talks to Alpaca (bars) — data.mjs's requireCreds() also
// hard-requires FMP_API_KEY, which this harness never uses. Router-local check
// (same pattern as scan.mjs).
function requireRouterCreds() {
  const missing = [
    !process.env.ALPACA_API_KEY_ID && "ALPACA_API_KEY_ID",
    !process.env.ALPACA_API_SECRET_KEY && "ALPACA_API_SECRET_KEY",
  ].filter(Boolean);
  if (missing.length) throw new Error(`missing env credentials: ${missing.join(", ")}`);
}

const etToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()); // "YYYY-MM-DD"

// ---- stats helpers — dependency-free, used only by this harness ----------------
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length;
  return m % 2 ? s[(m - 1) / 2] : (s[m / 2 - 1] + s[m / 2]) / 2;
}
function stdev(a, mu) {
  if (a.length < 2) return 0;
  const m = mu ?? mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
function tstat(a) {
  const n = a.length;
  if (n < 2) return 0;
  const m = mean(a), sd = stdev(a, m);
  if (sd === 0) return m === 0 ? 0 : (m > 0 ? Infinity : -Infinity);
  return m / (sd / Math.sqrt(n));
}
function trimmedMean(a, frac = 0.05) {
  const s = [...a].sort((x, y) => x - y);
  const k = Math.floor(s.length * frac);
  const t = k > 0 && s.length - 2 * k > 0 ? s.slice(k, s.length - k) : s;
  return mean(t);
}
function profitFactor(a) {
  const wins = a.filter((x) => x > 0).reduce((s, x) => s + x, 0);
  const lossSum = a.filter((x) => x <= 0).reduce((s, x) => s + x, 0); // <= 0
  if (lossSum === 0) return wins > 0 ? Infinity : 0;
  return wins / -lossSum;
}
const winPct = (a) => (a.filter((x) => x > 0).length / a.length) * 100;

function scoreRow(label, trades) {
  const rets = trades.map((t) => t.ret); // fractional, e.g. 0.012 = +1.2%
  const n = rets.length;
  if (n === 0) return { label, n: 0, meanPct: 0, medianPct: 0, winPct: 0, pf: 0, t: 0, trimmedMeanPct: 0 };
  return {
    label, n,
    meanPct: mean(rets) * 100,
    medianPct: median(rets) * 100,
    winPct: winPct(rets),
    pf: profitFactor(rets),
    t: tstat(rets),
    trimmedMeanPct: trimmedMean(rets, 0.05) * 100,
  };
}

// ---- args ------------------------------------------------------------------
// LANE_KEY maps the CLI --lane value to its LANES/config.mjs key. GATE_THRESH_KEY
// maps a GAP lane (momentum/jumpday) to the THRESH.* field that gates its entry —
// this is the ONLY thing that differs between the two gap lanes; everything else
// (construction, costs, split, verdict gate, --promote) is shared below. meanrev
// has no single gap-threshold gate (it's a different backtest, branched in the
// backtest section below), so it has no entry in GATE_THRESH_KEY.
const lane = process.argv.find((a) => a.startsWith("--lane="))?.split("=")[1];
const LANE_KEY = { momentum: "Momentum", jumpday: "JumpDay", meanrev: "MeanRev" };
const GATE_THRESH_KEY = { momentum: "gapMomentum", jumpday: "gapJump" };
if (!lane || !LANE_KEY[lane])
  throw new Error(`usage: --lane=momentum|jumpday|meanrev`);
const doPromote = process.argv.includes("--promote");
const laneKey = LANE_KEY[lane]; // "Momentum" | "JumpDay" | "MeanRev"
const gateThreshKey = GATE_THRESH_KEY[lane]; // "gapMomentum" | "gapJump" | undefined (meanrev)
const gateThresh = gateThreshKey ? THRESH[gateThreshKey] : undefined;

// ---- window ------------------------------------------------------------------
const end = etToday();
const start = daysBefore(end, 1825); // ~5y

requireRouterCreds();
console.log(`\nStrategy Router — VALIDATE ${laneKey} (currently ${LANES[laneKey].status})  ${start}..${end}  (${UNIVERSE.length} names)\n`);

// Daily cache, 24h TTL: reruns same trading day are free; next day picks up the new bar.
const bars = await alpacaBars(UNIVERSE, "1Day", start, end, `validate_${lane}`, 24);

// ---- the backtest — LEAK-FREE by construction ---------------------------------
const COST = 0.0004; // 2bps round-trip (entry + exit)
const trades = [];
// meanrev-only market-regime filter state — declared here (not inside the meanrev
// branch below) so the console/JSON report sections after the backtest can read
// it too. Stays false/empty for the gap lanes (momentum/jumpday), which never
// touch it.
let useRegime = false;
let regimeOK = new Map(); // "YYYY-MM-DD" -> boolean

if (lane === "meanrev") {
  // Thesis under test: classic Connors RSI2 mean-reversion dip-buy — buy an
  // oversold pullback (RSI2 < mrRsiEntry) while price is still in an uptrend
  // (close > SMA200), then sell either the reversion (close back above SMA5) or
  // a time-stop (mrMaxHold trading days). This is a DIFFERENT backtest than the
  // gap lanes above: no gap gate, multi-day hold, one position per symbol at a
  // time (new entry signals are ignored while a position is already open — no
  // pyramiding).
  //
  // LEAK-AVOIDANCE (read before touching the signal/fill split):
  //   RSI2[d], SMA200[d], SMA5[d] are all built from closes[0..d] only — every
  //   value is known the INSTANT bar d closes, nothing later is ever read. The
  //   liquidity floor (avgDollarVolM over d-20..d-1) uses exclusively COMPLETED
  //   prior bars — same convention as the gap lanes above. The ENTRY signal is
  //   evaluated at close[d] but FILLS at open[d+1] — the following bar's open,
  //   which does not exist yet at the moment the signal fires. The EXIT signal
  //   is evaluated symmetrically at close[e] and FILLS at open[e+1]. No same-day
  //   close price is ever used to fill a same-day order — every fill uses the
  //   NEXT bar's open, entry and exit alike.
  //
  // Wilder RSI(period) — matches TradingView's ta.rsi(close, period): RS =
  // RMA(gains, period) / RMA(losses, period), RMA seeded with a simple average
  // of the first `period` gain/loss values, then recursed with alpha=1/period.
  const computeRSI = (closes, period) => {
    const n = closes.length;
    const rsi = new Array(n).fill(null);
    const gains = new Array(n).fill(0), losses = new Array(n).fill(0);
    for (let i = 1; i < n; i++) {
      const chg = closes[i] - closes[i - 1];
      gains[i] = chg > 0 ? chg : 0;
      losses[i] = chg < 0 ? -chg : 0;
    }
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i < n; i++) {
      if (i < period) continue; // not enough seed data yet
      if (i === period) {
        let sg = 0, sl = 0;
        for (let k = 1; k <= period; k++) { sg += gains[k]; sl += losses[k]; }
        avgGain = sg / period; avgLoss = sl / period;
      } else {
        avgGain = (avgGain * (period - 1) + gains[i]) / period;
        avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
      }
      rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return rsi;
  };
  // Simple rolling-window SMA; sma[i] is defined once i >= period-1.
  const computeSMA = (closes, period) => {
    const n = closes.length;
    const sma = new Array(n).fill(null);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += closes[i];
      if (i >= period) sum -= closes[i - period];
      if (i >= period - 1) sma[i] = sum / period;
    }
    return sma;
  };

  // ---- market-regime filter (Phase 4c) ----------------------------------------
  // stress.mjs's regime split found this dip-buy breaks in the 2022 bear (2022
  // mean -0.50%, t=-2.53, statistically significant loss): buying an oversold dip
  // is a different bet when the BROAD MARKET is itself trending down vs up. Fix:
  // only take the dip-buy when SPY is above its own SMA(mrRegimeSMA) at the
  // signal's close — i.e. buy pullbacks WITHIN a market uptrend, don't catch
  // falling knives in a market downtrend. SPY.SMA(mrRegimeSMA)[i] is built from
  // SPY closes[0..i] only — known the instant SPY's own bar i closes, same
  // leak-free convention as every other gate in this file. ON by default for the
  // meanrev lane; pass --no-regime to disable for an A/B comparison.
  useRegime = !process.argv.includes("--no-regime");
  if (useRegime) {
    const spyBars = await alpacaBars(["SPY"], "1Day", start, end, "regime_spy", 24);
    const spyRaw = spyBars.get("SPY") ?? [];
    const spy = [...spyRaw].sort((x, y) => (x.t < y.t ? -1 : 1));
    const spyCloses = spy.map((x) => x.c);
    const spySma = computeSMA(spyCloses, THRESH.mrRegimeSMA);
    for (let i = 0; i < spy.length; i++) {
      if (spySma[i] == null) continue; // not warmed up yet
      regimeOK.set(spy[i].t.slice(0, 10), spyCloses[i] > spySma[i]);
    }
    console.log(`regime filter: ON — SPY close > SPY SMA(${THRESH.mrRegimeSMA}) required on the signal day (${regimeOK.size} SPY dates with a known regime flag)`);
  } else {
    console.log(`regime filter: OFF (--no-regime)`);
  }

  for (const sym of UNIVERSE) {
    const raw = bars.get(sym);
    // need THRESH.smaRegime (200) prior closes for SMA200 to warm up, plus the
    // same 20-day liquidity lookback the gap lanes use, plus headroom for a fill.
    if (!raw || raw.length < THRESH.smaRegime + 21) continue;
    const b = [...raw].sort((x, y) => (x.t < y.t ? -1 : 1));
    const closes = b.map((x) => x.c);
    const rsi2 = computeRSI(closes, THRESH.mrRsiPeriod);
    const sma200 = computeSMA(closes, THRESH.smaRegime); // reuse the existing 200-length regime SMA — no separate "200" constant
    const sma5 = computeSMA(closes, THRESH.mrExitSma);

    let inPosition = false, entryIdx = null, entryPrice = null, entryDate = null;
    for (let i = 0; i < b.length - 1; i++) { // i+1 must exist for every fill below
      if (inPosition) {
        // EXIT signal at close[i] (i plays the role of "e"): reversion above
        // SMA5, or the time-stop. FILL at open[i+1] — no leak.
        const heldDays = i - entryIdx;
        const exitSignal = (sma5[i] != null && closes[i] > sma5[i]) || heldDays >= THRESH.mrMaxHold;
        if (exitSignal) {
          const exitOpen = b[i + 1].o;
          if (exitOpen > 0) {
            const ret = (exitOpen - entryPrice) / entryPrice - COST;
            trades.push({ sym, date: entryDate, ret });
          }
          inPosition = false; entryIdx = null; entryPrice = null; entryDate = null;
        }
        continue; // one position at a time — ignore entry signals while in a position
      }

      // ENTRY signal at close[i] (i plays the role of "d"): oversold dip in an
      // uptrend, passing the same liquidity/price floors the gap lanes use.
      if (rsi2[i] == null || sma200[i] == null) continue; // not warmed up yet
      if (!(rsi2[i] < THRESH.mrRsiEntry)) continue;
      if (!(closes[i] > sma200[i])) continue;
      if (useRegime && regimeOK.get(b[i].t.slice(0, 10)) !== true) continue; // market itself not in an uptrend on the signal day (also skips if SPY has no bar for that date)
      if (i < 20) continue; // need 20 prior completed days for the liquidity floor
      let dvSum = 0; // avg $-volume over i-20..i-1 — completed bars only, no leak
      for (let k = i - 20; k <= i - 1; k++) dvSum += b[k].c * b[k].v;
      const avgDollarVolM = (dvSum / 20) / 1e6;
      if (avgDollarVolM < THRESH.minDollarVolM) continue;
      if (!(closes[i] >= THRESH.minPrice)) continue; // close[i] itself — known at close[i], no leak

      const entryOpen = b[i + 1].o; // FILL at open[d+1] — no leak
      if (!(entryOpen > 0)) continue;
      inPosition = true;
      entryIdx = i + 1; // the fill bar's index — also the mrMaxHold reference point
      entryPrice = entryOpen;
      entryDate = b[i + 1].t.slice(0, 10); // entry date = open[d+1]'s date, per spec
    }
  }
} else {
  // Thesis under test: "a large gap-up continues intraday" (long, same-day only).
  // The gate threshold (gateThresh) is the ONLY lane-specific input below — Momentum
  // gates on gapMomentum (>=3%), JumpDay on the bigger gapJump (>=5%); construction,
  // liquidity/price floors, cost, split, and verdict gate are identical for both.
  //
  // LEAK-AVOIDANCE (read before touching the gate):
  //   gapPct[d] = (open[d] - close[d-1]) / close[d-1] is known the INSTANT bar d opens
  //   — it is a legitimate entry signal. We deliberately do NOT gate on volume[d]
  //   (a same-day RVOL/volume-surge filter): full-day volume is only known at the
  //   close, so filtering entries on it would use information from the future and
  //   manufacture a mirage of edge that could never be traded live. The ONLY gate
  //   that uses day-d data is gapPct itself. Liquidity/price floors (avgDollarVolM
  //   over d-20..d-1, and close[d-1] >= minPrice) use exclusively COMPLETED prior
  //   bars, so they carry zero look-ahead — and they mirror the exact filters
  //   classify.mjs's routePremarket() already applies before a name ever reaches
  //   this lane in production, so the backtest tests the thesis as it is actually
  //   routed, not a looser strawman of it.
  for (const sym of UNIVERSE) {
    const raw = bars.get(sym);
    if (!raw || raw.length < 21) continue; // need 20 prior completed days + day d
    const b = [...raw].sort((x, y) => (x.t < y.t ? -1 : 1));
    for (let d = 20; d < b.length; d++) {
      const prevClose = b[d - 1].c;
      const open = b[d].o, close = b[d].c;
      if (!(prevClose > 0) || !(open > 0)) continue;

      const gapPct = (open - prevClose) / prevClose * 100; // known AT open[d] — no leak
      if (gapPct < gateThresh) continue;

      if (prevClose < THRESH.minPrice) continue; // close[d-1] — completed bar, no leak

      let dvSum = 0; // avg $-volume over d-20..d-1 — completed bars only, no leak
      for (let k = d - 20; k <= d - 1; k++) dvSum += b[k].c * b[k].v;
      const avgDollarVolM = (dvSum / 20) / 1e6;
      if (avgDollarVolM < THRESH.minDollarVolM) continue;

      const ret = (close - open) / open - COST; // enter open[d], exit close[d] (same-day continuation)
      trades.push({ sym, date: b[d].t.slice(0, 10), gapPct: +gapPct.toFixed(2), ret });
    }
  }
}

// ---- holdout split: sort by date, older half = IN, newer half = OUT ------------
trades.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
const n = trades.length;
const midDate = n ? trades[Math.floor(n / 2)].date : null;
const inSample = midDate ? trades.filter((t) => t.date < midDate) : [];
const outSample = midDate ? trades.filter((t) => t.date >= midDate) : [];

const rows = {
  ALL: scoreRow("ALL", trades),
  IN: scoreRow("IN", inSample),
  OUT: scoreRow("OUT", outSample),
};

// ---- verdict: PROMOTE iff mean/median/trimmedMean>0 AND t>=2, holding in BOTH
// IN and OUT (not just the pooled ALL sample) AND overall n>=100. Any single
// failing check anywhere forces HOLD — this is the strict holdout gate. -------
const reasons = [];
for (const label of ["IN", "OUT"]) {
  const r = rows[label];
  if (r.n === 0) { reasons.push(`${label}: no trades (n=0)`); continue; }
  if (!(r.meanPct > 0)) reasons.push(`${label}: mean% <= 0 (${r.meanPct.toFixed(3)}%)`);
  if (!(r.medianPct > 0)) reasons.push(`${label}: median% <= 0 (${r.medianPct.toFixed(3)}%)`);
  if (!(r.trimmedMeanPct > 0)) reasons.push(`${label}: 5%-trimmed-mean% <= 0 (${r.trimmedMeanPct.toFixed(3)}%)`);
  if (!(r.t >= 2)) reasons.push(`${label}: t-stat < 2 (t=${Number.isFinite(r.t) ? r.t.toFixed(2) : r.t})`);
}
if (!(rows.ALL.n >= 100)) reasons.push(`ALL: n < 100 (n=${rows.ALL.n})`);
const verdict = reasons.length ? "HOLD" : "PROMOTE";

// ---- console report ------------------------------------------------------------
const pfStr = (v) => (v === 0 ? "0.00" : Number.isFinite(v) ? v.toFixed(2) : "∞");
const tStr = (v) => (Number.isFinite(v) ? v.toFixed(2) : (v > 0 ? "+∞" : "-∞"));
const line = (r) =>
  `  ${r.label.padEnd(4)} n=${String(r.n).padStart(4)}   mean=${r.meanPct.toFixed(3).padStart(8)}%` +
  `   median=${r.medianPct.toFixed(3).padStart(8)}%   win=${r.winPct.toFixed(1).padStart(6)}%` +
  `   PF=${pfStr(r.pf).padStart(6)}   t=${tStr(r.t).padStart(7)}   trimmed=${r.trimmedMeanPct.toFixed(3).padStart(8)}%`;

if (lane === "meanrev") {
  console.log(`gate: RSI(${THRESH.mrRsiPeriod})[d] < ${THRESH.mrRsiEntry}  ·  close[d] > SMA${THRESH.smaRegime}[d]  ·  avgDollarVol(d-20..d-1) >= $${THRESH.minDollarVolM}M  ·  close[d] >= $${THRESH.minPrice}` +
    (useRegime ? `  ·  SPY.close[d] > SPY.SMA${THRESH.mrRegimeSMA}[d]` : `  ·  regime filter OFF (--no-regime)`) +
    `  ·  exit close[e] > SMA${THRESH.mrExitSma}[e] or hold>=${THRESH.mrMaxHold}d  ·  cost ${(COST * 100).toFixed(2)}% round-trip`);
} else {
  console.log(`gate: gapPct[d] >= ${gateThresh}%  ·  close[d-1] >= $${THRESH.minPrice}  ·  avgDollarVol(d-20..d-1) >= $${THRESH.minDollarVolM}M  ·  cost ${(COST * 100).toFixed(2)}% round-trip`);
}
console.log(`entries by symbol/date, split at midDate=${midDate ?? "–"} (older=IN, newer=OUT)\n`);
console.log(line(rows.ALL));
console.log(line(rows.IN));
console.log(line(rows.OUT));
console.log(`\nVERDICT: ${verdict}`);
if (reasons.length) {
  console.log("reason(s) HOLD:");
  reasons.forEach((r) => console.log(`  - ${r}`));
} else {
  console.log(`all gates passed in BOTH IN and OUT samples (mean>0, median>0, trimmedMean>0, t>=2) and n=${rows.ALL.n} >= 100.`);
}

// ---- JSON sink -------------------------------------------------------------
const DIR = fileURLToPath(new URL("./scans/", import.meta.url));
mkdirSync(DIR, { recursive: true });
const outFile = `${DIR}validation-${lane}-${end}.json`;
const report = {
  lane: laneKey,
  laneStatusBefore: LANES[laneKey].status,
  generated: {
    generatedAt: new Date().toISOString(),
    gitSha: gitSha(),
    dataProvider: "Alpaca SIP daily bars",
    feed: "sip",
    adjustment: "split",
    barTimeframe: "1Day",
    universeCount: UNIVERSE.length,
    dateRange: `${start}..${end}`,
  },
  config: lane === "meanrev" ? {
    mrRsiEntry: THRESH.mrRsiEntry,
    mrRsiPeriod: THRESH.mrRsiPeriod,
    smaTrend: THRESH.smaRegime,
    mrExitSma: THRESH.mrExitSma,
    mrMaxHold: THRESH.mrMaxHold,
    minPrice: THRESH.minPrice,
    minDollarVolM: THRESH.minDollarVolM,
    costRoundTrip: COST,
    regimeFilterEnabled: useRegime,
    mrRegimeSMA: THRESH.mrRegimeSMA,
    regimeFilterSymbol: "SPY",
  } : {
    [gateThreshKey]: gateThresh,
    minPrice: THRESH.minPrice,
    minDollarVolM: THRESH.minDollarVolM,
    costRoundTrip: COST,
  },
  leakAvoidance: lane === "meanrev" ? [
    "entry signal = RSI(mrRsiPeriod)[d] < mrRsiEntry AND close[d] > SMA(smaRegime)[d], both known at close[d] — RSI2/SMA200/SMA5 are all built from closes[0..d] only, nothing later is ever read",
    "liquidity/price floors use avgDollarVol(d-20..d-1) (completed prior bars) and close[d] itself — no look-ahead",
    "entry FILLS at open[d+1] — the bar after the signal fires, never the signal bar's own close",
    "exit signal = close[e] > SMA(mrExitSma)[e] OR (e-entryIndex) >= mrMaxHold, known at close[e]; exit FILLS at open[e+1] — symmetric with entry, never a same-bar fill",
    "one position per symbol at a time — new entry signals are ignored while a position is already open (no pyramiding)",
    useRegime
      ? "REGIME FILTER (default ON, --no-regime to disable): entry additionally requires SPY.close[d] > SPY.SMA(mrRegimeSMA)[d] — SPY's own SMA is built from SPY closes[0..d] only, known the instant SPY's bar d closes; dates with no SPY bar are treated as regime-NOT-ok (entry skipped) — no look-ahead, added to neutralize the 2022 bear-market fragility found in stress.mjs"
      : "REGIME FILTER: disabled via --no-regime for this run — entries are NOT gated on SPY's trend (A/B comparison mode)",
    "SCOPE: this validates the daily-bar Connors RSI2 mean-reversion proxy only. The production MeanRev lane currently routes on a crude ADX<20/above-200SMA flag, and the true Super-1 thesis is intraday VWAP+RSI2 — a PROMOTE here validates the mean-reversion THESIS, not the router's current entry rule. Wiring the router's MeanRev entry to this exact rule is a separate follow-up.",
  ] : [
    "gate = gapPct[d] = (open[d]-close[d-1])/close[d-1], known at open[d] — the only day-d field used for entry",
    "liquidity/price floors use avgDollarVol(d-20..d-1) and close[d-1] only — completed prior bars, no look-ahead",
    "volume[d] (same-day RVOL/volume-surge) is deliberately NOT used as a gate — full-day volume is unknown at open[d]; gating on it would be look-ahead",
    "entry at open[d], exit at close[d] — same-day continuation, matching the lane's thesis",
  ],
  tradeCount: n,
  midDate,
  scorecard: rows,
  verdict,
  reasons,
};
writeFileSync(outFile, JSON.stringify(report, null, 2));
console.log(`\nsaved -> ${outFile}`);

// ---- promotion — ONLY on a PROMOTE verdict, ONLY with --promote ----------------
if (doPromote) {
  if (verdict !== "PROMOTE") {
    console.log(`\n--promote given but verdict is HOLD — no change made (a HOLD is never promoted).`);
  } else {
    const cfgFile = fileURLToPath(new URL("./config.mjs", import.meta.url));
    const src = readFileSync(cfgFile, "utf8");
    const re = new RegExp(`(${laneKey}:\\s*\\{[^}]*status:\\s*")PAPER(")`);
    if (!re.test(src))
      throw new Error(`promote: could not find ${laneKey} PAPER status line in config.mjs (already LIVE, or format changed) — refusing to write`);
    writeFileSync(cfgFile, src.replace(re, "$1LIVE$2"));
    console.log(`\nPROMOTED: LANES.${laneKey}.status "PAPER" -> "LIVE" in ${cfgFile}`);
  }
} else {
  console.log(`\n(no --promote passed — config.mjs unchanged; verdict is report-only)`);
}
console.log("");
