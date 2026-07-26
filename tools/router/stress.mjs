// Strategy Router — Phase 4b: MeanRev SURVIVORSHIP / CORRELATION stress test.
// tools/router/validate.mjs --lane=meanrev PROMOTEd the classic Connors RSI2
// dip-buy thesis on the hand-picked 87-name UNIVERSE (config.mjs): OUT t=3.39,
// PF~1.36-1.48, ~65% win. That result has two known weaknesses this file attacks:
//   (a) SURVIVORSHIP/CURATION — the 87 are hand-picked, all still trading today.
//       A backtest on "names someone chose because they're still around" is
//       upward-biased in a way a train/holdout date split can never remove
//       (the split only tests OUT-of-TIME, never OUT-of-UNIVERSE).
//   (b) CORRELATION — validate.mjs's per-trade scorecard treats every RSI2
//       signal as an independently-funded trade. In reality a market-wide
//       selloff fires RSI2<10 on dozens of names the SAME day — the "2,171
//       independent 65%-win trades" picture hides the fact that a real
//       portfolio can only hold so many positions at once, and they draw down
//       together, not independently.
//
// All four stresses below reuse validate.mjs's meanrev entry/exit logic
// VERBATIM (same leak-free fills — entry FILLS at open[d+1], exit FILLS at
// open[e+1] — same Wilder RSI(2), same SMA200/SMA5, same COST convention).
// Nothing about the thesis is redefined here; only the UNIVERSE (stress 1),
// the CAPITAL ALLOCATION model (stress 2), the TIME SLICE (stress 3), or the
// COST (stress 4) is varied. Run:
//   node --env-file=.env tools/router/stress.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { alpacaBars, fmpUniverse, gitSha } from "../research/lib/data.mjs";
import { daysBefore } from "../research/lib/dates.mjs";
import { THRESH } from "./config.mjs";

// This harness needs Alpaca (bars, same as the rest of the router) AND FMP
// (the broad screener universe for stress 1-4) — unlike validate.mjs/scan.mjs,
// which are Alpaca-only and deliberately skip data.mjs's FMP requirement.
function requireCreds() {
  const missing = [
    !process.env.ALPACA_API_KEY_ID && "ALPACA_API_KEY_ID",
    !process.env.ALPACA_API_SECRET_KEY && "ALPACA_API_SECRET_KEY",
    !process.env.FMP_API_KEY && "FMP_API_KEY",
  ].filter(Boolean);
  if (missing.length) throw new Error(`missing env credentials: ${missing.join(", ")}`);
}

const etToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()); // "YYYY-MM-DD"

// ---- stats helpers — copied verbatim from validate.mjs (dependency-free) -------
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
  const rets = trades.map((t) => t.ret);
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
const pfStr = (v) => (v === 0 ? "0.00" : Number.isFinite(v) ? v.toFixed(2) : "∞");
const tStr = (v) => (Number.isFinite(v) ? v.toFixed(2) : (v > 0 ? "+∞" : "-∞"));
const line = (r) =>
  `  ${String(r.label).padEnd(6)} n=${String(r.n).padStart(4)}   mean=${r.meanPct.toFixed(3).padStart(8)}%` +
  `   median=${r.medianPct.toFixed(3).padStart(8)}%   win=${r.winPct.toFixed(1).padStart(6)}%` +
  `   PF=${pfStr(r.pf).padStart(6)}   t=${tStr(r.t).padStart(7)}   trimmed=${r.trimmedMeanPct.toFixed(3).padStart(8)}%`;

// ---- config --------------------------------------------------------------------
const COST_BASE = 0.0004; // identical to validate.mjs's COST — labeled "2bps round-trip" there
const MAX_CONCURRENT = 10; // stress 2 portfolio slot cap
const WEIGHT_PER_SLOT = 1 / MAX_CONCURRENT; // 10% fixed sizing per slot; unused slots sit in cash (0% that day) — see caveats
const BROAD_CAP = 500; // top-N by FMP screener order (documented mcap-desc in data.mjs) if the full screener is too slow to bar-fetch

const end = etToday();
const start = daysBefore(end, 1825); // ~5y, identical window to validate.mjs

requireCreds();
console.log(`\nStrategy Router — MeanRev STRESS TEST (survivorship + correlation)  ${start}..${end}\n`);

// ---- STRESS-1 universe: broad FMP screener constituents, not the hand-picked 87 -
// This removes CURATION bias (someone hand-picking 87 "good" tickers) but NOT full
// survivorship bias: the FMP screener returns TODAY's active listings, so names that
// delisted/went bankrupt anywhere in the 5y window are still absent. That residual
// limit is real and is called out again in the final report below.
const rawUniverse = await fmpUniverse(); // [{symbol, companyName}], FMP-ordered (docs claim mcap-desc)
const capped = rawUniverse.length > BROAD_CAP;
const broadEntries = capped ? rawUniverse.slice(0, BROAD_CAP) : rawUniverse;
const BROAD = broadEntries.map((e) => e.symbol);
console.log(`broad universe: FMP screener returned ${rawUniverse.length} names` +
  (capped ? ` -> capped to top ${BROAD_CAP} (FMP screener order, documented as market-cap-descending in data.mjs) for bar-fetch speed` : " (no cap needed)"));

// Daily cache, 24h TTL — same convention as validate.mjs.
const bars = await alpacaBars(BROAD, "1Day", start, end, "stress_meanrev_broad", 24);

// ---- RSI/SMA — copied verbatim from validate.mjs's meanrev branch --------------
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
    if (i < period) continue;
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

// ---- market-regime filter (meanrev only, matches validate.mjs's default-ON rule) -
// STRESS 3 below is what originally found the 2022 bear fragility (2022 mean
// -0.50%, t=-2.53) — that finding is what motivated this filter. Applying it here
// too (not just in validate.mjs) means STRESS 1/2/3/4 all report the AFTER picture:
// entries additionally require SPY.close[d] > SPY.SMA(mrRegimeSMA)[d], known the
// instant SPY's own bar d closes (SPY's SMA is built from SPY closes[0..d] only —
// no look-ahead). Dates with no SPY bar are treated as regime-NOT-ok (entry
// skipped). ON by default; --no-regime disables it for an A/B comparison, same
// flag name as validate.mjs.
const useRegime = !process.argv.includes("--no-regime");
const regimeOK = new Map(); // "YYYY-MM-DD" -> boolean
if (useRegime) {
  const spyBars = await alpacaBars(["SPY"], "1Day", start, end, "regime_spy", 24);
  const spyRaw = spyBars.get("SPY") ?? [];
  const spy = [...spyRaw].sort((x, y) => (x.t < y.t ? -1 : 1));
  const spyCloses = spy.map((x) => x.c);
  const spySma = computeSMA(spyCloses, THRESH.mrRegimeSMA);
  for (let i = 0; i < spy.length; i++) {
    if (spySma[i] == null) continue;
    regimeOK.set(spy[i].t.slice(0, 10), spyCloses[i] > spySma[i]);
  }
  console.log(`regime filter: ON — SPY close > SPY SMA(${THRESH.mrRegimeSMA}) required on the signal day (${regimeOK.size} SPY dates with a known regime flag)\n`);
} else {
  console.log(`regime filter: OFF (--no-regime)\n`);
}

// ---- per-symbol precompute -------------------------------------------------------
const symData = new Map(); // symbol -> { b, closes, opens, vols, dates, rsi2, sma200, sma5 }
for (const sym of BROAD) {
  const raw = bars.get(sym);
  if (!raw || raw.length < THRESH.smaRegime + 21) continue; // same warm-up floor as validate.mjs
  const b = [...raw].sort((x, y) => (x.t < y.t ? -1 : 1));
  const closes = b.map((x) => x.c), opens = b.map((x) => x.o), vols = b.map((x) => x.v);
  const dates = b.map((x) => x.t.slice(0, 10));
  const rsi2 = computeRSI(closes, THRESH.mrRsiPeriod);
  const sma200 = computeSMA(closes, THRESH.smaRegime);
  const sma5 = computeSMA(closes, THRESH.mrExitSma);
  symData.set(sym, { b, closes, opens, vols, dates, rsi2, sma200, sma5 });
}
console.log(`usable symbols (>= ${THRESH.smaRegime + 21} bars): ${symData.size} / ${BROAD.length}\n`);

// Entry gate — identical predicate to validate.mjs's inline meanrev entry check.
// i is the SIGNAL index ("d"); everything read is closes[0..i] + vols[i-20..i-1] —
// no look-ahead. Caller still must confirm b[i+1] exists before using i as a fill.
function passesEntryGate(d, i) {
  if (d.rsi2[i] == null || d.sma200[i] == null) return false;
  if (!(d.rsi2[i] < THRESH.mrRsiEntry)) return false;
  if (!(d.closes[i] > d.sma200[i])) return false;
  if (useRegime && regimeOK.get(d.dates[i]) !== true) return false; // market itself not in an uptrend on the signal day (also fails if SPY has no bar for that date)
  if (i < 20) return false;
  let dvSum = 0;
  for (let k = i - 20; k <= i - 1; k++) dvSum += d.closes[k] * d.vols[k];
  const avgDollarVolM = (dvSum / 20) / 1e6;
  if (avgDollarVolM < THRESH.minDollarVolM) return false;
  if (!(d.closes[i] >= THRESH.minPrice)) return false;
  return true;
}

// ======================================================================
// STRESS 1 — BROADER UNIVERSE (curation de-bias)
// Same one-position-per-symbol, leak-free RSI2 backtest as validate.mjs, run
// on the broad screener universe instead of the hand-picked 87.
// ======================================================================
function independentTrades(cost) {
  const trades = [];
  for (const [sym, d] of symData) {
    const b = d.b;
    let inPosition = false, entryIdx = null, entryPrice = null, entryDate = null;
    for (let i = 0; i < b.length - 1; i++) {
      if (inPosition) {
        const heldDays = i - entryIdx;
        const exitSignal = (d.sma5[i] != null && d.closes[i] > d.sma5[i]) || heldDays >= THRESH.mrMaxHold;
        if (exitSignal) {
          const exitOpen = b[i + 1].o;
          if (exitOpen > 0) {
            const rawRet = (exitOpen - entryPrice) / entryPrice;
            trades.push({ sym, date: entryDate, rawRet, ret: rawRet - cost });
          }
          inPosition = false; entryIdx = null; entryPrice = null; entryDate = null;
        }
        continue;
      }
      if (!passesEntryGate(d, i)) continue;
      const entryOpen = b[i + 1].o;
      if (!(entryOpen > 0)) continue;
      inPosition = true;
      entryIdx = i + 1;
      entryPrice = entryOpen;
      entryDate = d.dates[i + 1];
    }
  }
  return trades;
}

const tradesBroad = independentTrades(COST_BASE);
tradesBroad.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
const nBroad = tradesBroad.length;
const midDateBroad = nBroad ? tradesBroad[Math.floor(nBroad / 2)].date : null;
const inBroad = midDateBroad ? tradesBroad.filter((t) => t.date < midDateBroad) : [];
const outBroad = midDateBroad ? tradesBroad.filter((t) => t.date >= midDateBroad) : [];
const rowsBroad = { ALL: scoreRow("ALL", tradesBroad), IN: scoreRow("IN", inBroad), OUT: scoreRow("OUT", outBroad) };

// Same PROMOTE gate as validate.mjs (mean/median/trimmedMean>0 AND t>=2 in BOTH
// IN and OUT, n>=100) applied here purely for an apples-to-apples read — this
// script never writes a verdict to config.mjs, it only reports.
const gateReasons = [];
for (const lbl of ["IN", "OUT"]) {
  const r = rowsBroad[lbl];
  if (r.n === 0) { gateReasons.push(`${lbl}: no trades`); continue; }
  if (!(r.meanPct > 0)) gateReasons.push(`${lbl}: mean% <= 0`);
  if (!(r.medianPct > 0)) gateReasons.push(`${lbl}: median% <= 0`);
  if (!(r.trimmedMeanPct > 0)) gateReasons.push(`${lbl}: trimmedMean% <= 0`);
  if (!(r.t >= 2)) gateReasons.push(`${lbl}: t < 2`);
}
if (!(rowsBroad.ALL.n >= 100)) gateReasons.push("ALL: n < 100");
const wouldPromoteBroad = gateReasons.length === 0;

console.log("=".repeat(90));
console.log("STRESS 1 — BROADER UNIVERSE (curation de-bias)");
console.log("=".repeat(90));
console.log(`gate: RSI(${THRESH.mrRsiPeriod})[d] < ${THRESH.mrRsiEntry} · close[d] > SMA${THRESH.smaRegime}[d]` +
  (useRegime ? ` · SPY.close[d] > SPY.SMA${THRESH.mrRegimeSMA}[d]` : ` · regime filter OFF (--no-regime)`) +
  ` · avgDollarVol(d-20..d-1) >= $${THRESH.minDollarVolM}M · close[d] >= $${THRESH.minPrice} · exit close[e] > SMA${THRESH.mrExitSma}[e] or hold>=${THRESH.mrMaxHold}d · cost ${(COST_BASE * 100).toFixed(2)}% round-trip`);
console.log(`universe: ${symData.size} usable names (of ${BROAD.length} broad, capped from ${rawUniverse.length})  ·  split at midDate=${midDateBroad ?? "-"}\n`);
console.log(line(rowsBroad.ALL));
console.log(line(rowsBroad.IN));
console.log(line(rowsBroad.OUT));
console.log(`\nsame PROMOTE gate as validate.mjs on this universe: ${wouldPromoteBroad ? "WOULD PROMOTE" : "WOULD HOLD"}`);
if (gateReasons.length) gateReasons.forEach((r) => console.log(`  - ${r}`));
console.log(`\nHONEST CAVEAT: this removes CURATION bias (the hand-picked 87) but NOT full`);
console.log(`survivorship bias — FMP's screener returns TODAY's active listings, so any name`);
console.log(`that delisted, went bankrupt, or got acquired during 2021-2026 is absent from this`);
console.log(`universe too. The de-bias here is partial, not complete.\n`);

// ======================================================================
// STRESS 2 — PORTFOLIO / CORRELATION SIM (on the broad universe)
// Each day, among names with an open RSI2 entry signal, hold up to
// MAX_CONCURRENT equal-weight (fixed 1/MAX_CONCURRENT) slots; if more
// signals fire than there are free slots, take the most-oversold (lowest
// RSI2) first. Unused slots sit in cash (0% that day) — this is a capacity
// constraint, not a leverage model. Position sizing/exit logic is otherwise
// identical to STRESS 1 (same fills, same COST_BASE).
// ======================================================================

// buildTrade(d, entryFillIdx): given a KNOWN fill index (the day AFTER a
// signal), deterministically resolve the exit exactly like validate.mjs's
// exit loop — this does not depend on portfolio state, only on price data,
// so it's safe to precompute for every candidate signal whether or not the
// candidate actually wins a slot.
function buildTrade(d, entryFillIdx, cost) {
  const b = d.b;
  if (entryFillIdx >= b.length) return null;
  const entryPrice = b[entryFillIdx].o;
  if (!(entryPrice > 0)) return null;
  for (let i = entryFillIdx; i < b.length - 1; i++) {
    const heldDays = i - entryFillIdx;
    const exitSignal = (d.sma5[i] != null && d.closes[i] > d.sma5[i]) || heldDays >= THRESH.mrMaxHold;
    if (!exitSignal) continue;
    const exitFillIdx = i + 1;
    const exitPrice = b[exitFillIdx].o;
    if (!(exitPrice > 0)) return null;
    const ret = (exitPrice - entryPrice) / entryPrice - cost;
    // Per-day return decomposition for the equity curve. Telescopes exactly to
    // (exitPrice/entryPrice - 1) before cost: entry day is open->close, each
    // held day is close->close, exit day is prevClose->open (cost deducted once,
    // on the exit day, matching validate.mjs's single round-trip deduction).
    const dayReturns = new Map();
    for (let k = entryFillIdx; k <= exitFillIdx; k++) {
      let r;
      if (k === entryFillIdx) r = b[k].c / b[k].o - 1;
      else if (k === exitFillIdx) r = b[k].o / b[k - 1].c - 1 - cost;
      else r = b[k].c / b[k - 1].c - 1;
      dayReturns.set(d.dates[k], r);
    }
    return { entryDate: d.dates[entryFillIdx], exitDate: d.dates[exitFillIdx], ret, dayReturns };
  }
  return null; // exit never resolved within the fetched window
}

// candidatesByDate: fill-date -> [{sym, rsi2AtSignal, trade}], built for EVERY
// entry-eligible signal day of every symbol (not gated by "already in a
// position" — that's a PORTFOLIO-state concept, applied during the simulation
// below, not here).
const candidatesByDate = new Map();
for (const [sym, d] of symData) {
  const b = d.b;
  for (let i = 20; i < b.length - 1; i++) {
    if (!passesEntryGate(d, i)) continue;
    const entryFillIdx = i + 1;
    const trade = buildTrade(d, entryFillIdx, COST_BASE);
    if (!trade) continue;
    const date = d.dates[entryFillIdx];
    if (!candidatesByDate.has(date)) candidatesByDate.set(date, []);
    candidatesByDate.get(date).push({ sym, rsi2AtSignal: d.rsi2[i], trade });
  }
}

// Trim the simulated window to start at the first date ANY signal could ever
// fire — otherwise ~10 months of forced 200-SMA warm-up (flat 0% cash) drags
// CAGR/Sharpe down for a reason that has nothing to do with the strategy.
const candidateDates = [...candidatesByDate.keys()].sort();
const firstCandidateDate = candidateDates[0] ?? start;
const allDatesSet = new Set();
for (const [, d] of symData) for (const dt of d.dates) allDatesSet.add(dt);
const simDates = [...allDatesSet].filter((dt) => dt >= firstCandidateDate).sort();

function simulatePortfolio(maxConcurrent, weight) {
  const open = new Map(); // sym -> trade
  let equity = 1;
  const equityCurve = [];
  const dailyReturns = [];
  const heldPositionCounts = []; // resident positions AFTER same-day exits clear — bounded by maxConcurrent by construction
  const signalDemandCounts = []; // RAW candidate count per day, uncapped — the true correlation-clustering tell
  for (const date of simDates) {
    const exitingSyms = [...open.entries()].filter(([, tr]) => tr.exitDate === date).map(([s]) => s);
    const openAfterExits = open.size - exitingSyms.length;
    const freeSlots = maxConcurrent - openAfterExits;
    const rawCands = candidatesByDate.get(date) ?? [];
    signalDemandCounts.push(rawCands.length);
    if (freeSlots > 0) {
      const cands = rawCands
        .filter((c) => !open.has(c.sym) || exitingSyms.includes(c.sym))
        .sort((a, b) => a.rsi2AtSignal - b.rsi2AtSignal); // most oversold first
      for (let k = 0; k < Math.min(freeSlots, cands.length); k++) open.set(cands[k].sym, cands[k].trade);
    }
    // dayRet sums EVERY position currently in `open`, including ones exiting
    // today (their exit-day leg must still count) — computed BEFORE the
    // same-day exits are cleared below.
    let dayRet = 0;
    for (const [, tr] of open) if (tr.dayReturns.has(date)) dayRet += tr.dayReturns.get(date) * weight;
    equity *= 1 + dayRet;
    dailyReturns.push(dayRet);
    equityCurve.push({ date, equity });
    for (const s of exitingSyms) open.delete(s); // clear same-day exits BEFORE the concurrency snapshot below,
    heldPositionCounts.push(open.size);           // so held-position count never exceeds maxConcurrent
  }
  return { equityCurve, dailyReturns, heldPositionCounts, signalDemandCounts };
}

const sim = simulatePortfolio(MAX_CONCURRENT, WEIGHT_PER_SLOT);
const nSimDays = sim.equityCurve.length;
const finalEquity = nSimDays ? sim.equityCurve[nSimDays - 1].equity : 1;
const cagrPct = nSimDays ? (finalEquity ** (252 / nSimDays) - 1) * 100 : 0;
let peak = -Infinity, maxDD = 0;
for (const pt of sim.equityCurve) {
  peak = Math.max(peak, pt.equity);
  maxDD = Math.min(maxDD, (pt.equity - peak) / peak);
}
const maxDrawdownPct = maxDD * 100;
const muDaily = mean(sim.dailyReturns), sdDaily = stdev(sim.dailyReturns, muDaily);
const sharpeAnn = sdDaily === 0 ? 0 : (muDaily / sdDaily) * Math.sqrt(252);
// heldPositionCounts is bounded by MAX_CONCURRENT by construction (it's a resident
// count taken AFTER same-day exits clear) — it shows capital UTILIZATION.
// signalDemandCounts is UNCAPPED (raw qualifying-signal count per day, before the
// slot cap ever applies) — it shows true correlation clustering: how oversubscribed
// the 10-slot cap gets on a market-wide dip day.
const avgHeld = sim.heldPositionCounts.length ? mean(sim.heldPositionCounts) : 0;
const maxHeld = sim.heldPositionCounts.length ? Math.max(...sim.heldPositionCounts) : 0;
const avgDemand = sim.signalDemandCounts.length ? mean(sim.signalDemandCounts) : 0;
const maxDemand = sim.signalDemandCounts.length ? Math.max(...sim.signalDemandCounts) : 0;

console.log("=".repeat(90));
console.log("STRESS 2 — PORTFOLIO / CORRELATION SIM (broad universe)");
console.log("=".repeat(90));
console.log(`maxConcurrent=${MAX_CONCURRENT} slots · fixed weight=${(WEIGHT_PER_SLOT * 100).toFixed(0)}%/slot (unused slots = cash, 0% that day) · tie-break = lowest RSI2 (most oversold)`);
console.log(`simulated window: ${firstCandidateDate}..${simDates[simDates.length - 1] ?? "-"}  (${nSimDays} trading days, trimmed to skip the SMA200 warm-up dead zone)\n`);
console.log(`  CAGR:               ${cagrPct.toFixed(2)}%`);
console.log(`  Max drawdown:       ${maxDrawdownPct.toFixed(2)}%`);
console.log(`  Sharpe (annualized): ${sharpeAnn.toFixed(2)}`);
console.log(`  Avg/max HELD positions (capacity used, capped at ${MAX_CONCURRENT}):   ${avgHeld.toFixed(2)} / ${maxHeld}`);
console.log(`  Avg/max qualifying SIGNALS/day (uncapped demand):        ${avgDemand.toFixed(2)} / ${maxDemand}`);
console.log(`  Final equity multiple: ${finalEquity.toFixed(3)}x\n`);
console.log(`CONCENTRATION TELL: the 10-slot cap is full on a typical day (avg ${avgHeld.toFixed(1)}/${MAX_CONCURRENT} held), and` +
  ` on the busiest day ${maxDemand} names qualified simultaneously against only ${MAX_CONCURRENT} slots` +
  (maxDemand > MAX_CONCURRENT ? ` — capital-constrained skips are real and frequent; the per-trade stats in STRESS 1 (which fund every signal independently) overstate deployable edge whenever demand exceeds ${MAX_CONCURRENT}.` : `; demand never exceeded capacity in this simulation, so correlation clustering did not bottleneck capital.`));
console.log("");

// ======================================================================
// STRESS 3 — REGIME SPLIT (per-calendar-year, broad universe trades)
// ======================================================================
const startYear = Number(start.slice(0, 4)), endYear = Number(end.slice(0, 4));
const yearRows = [];
for (let y = startYear; y <= endYear; y++) {
  const yTrades = tradesBroad.filter((t) => t.date.slice(0, 4) === String(y));
  yearRows.push({ year: y, ...scoreRow(String(y), yTrades) });
}
const row2022 = yearRows.find((r) => r.year === 2022);
const bearFlag = row2022 && row2022.n > 0 && row2022.meanPct <= 0;

console.log("=".repeat(90));
console.log("STRESS 3 — REGIME SPLIT (per-calendar-year, broad universe)");
console.log("=".repeat(90));
yearRows.forEach((r) => console.log(line({ ...r, label: String(r.year) })));
console.log("");
if (row2022) {
  if (bearFlag) {
    console.log(`⚠ 2022 (bear market) mean% is NEGATIVE (${row2022.meanPct.toFixed(3)}%, n=${row2022.n}, t=${tStr(row2022.t)}) — this dip-buy thesis is FRAGILE across regimes, not a bull-market-only artifact test to worry about.`);
  } else if (row2022.n === 0) {
    console.log(`2022: no trades in this window (n=0) — cannot assess bear-market behavior from this sample.`);
  } else {
    console.log(`2022 (bear market) mean% is POSITIVE (${row2022.meanPct.toFixed(3)}%, n=${row2022.n}, t=${tStr(row2022.t)}) — the thesis did not obviously break in a down year.`);
  }
}
console.log("");

// ======================================================================
// STRESS 4 — COST SENSITIVITY
// Uses STRESS 1's broad-universe trades' pre-cost rawRet, re-costed at
// several round-trip levels. NOTE ON UNITS: validate.mjs's own COST constant
// (0.0004) is commented "2bps round-trip" but numerically equals 4bps under
// the standard 1bp=0.0001 definition. To avoid inheriting that ambiguity,
// this sweep uses the LITERAL standard definition (2bps=0.0002, 5bps=0.0005,
// 10bps=0.0010) — so the "2bps" row here is HALF of COST_BASE used in
// stresses 1-3. Both are reported so the reader can compare either way.
// ======================================================================
const costLevels = [
  { label: "2bps (standard)", bps: 2, cost: 0.0002 },
  { label: "5bps (standard)", bps: 5, cost: 0.0005 },
  { label: "10bps (standard)", bps: 10, cost: 0.0010 },
];
const costRows = costLevels.map((c) => ({
  ...c,
  ...scoreRow(c.label, tradesBroad.map((t) => ({ ret: t.rawRet - c.cost }))),
}));
const baselineRow = { label: `${(COST_BASE * 10000).toFixed(0)}bps (repo's COST_BASE, validate.mjs convention)`, ...scoreRow("base", tradesBroad) };

console.log("=".repeat(90));
console.log("STRESS 4 — COST SENSITIVITY (broad universe trades, re-costed)");
console.log("=".repeat(90));
console.log(line(baselineRow));
costRows.forEach((r) => console.log(line(r)));
const survivesAt10bps = costRows[2].meanPct > 0 && costRows[2].t >= 2;
console.log(`\nedge survives up to 10bps round-trip: ${survivesAt10bps ? "YES (mean% and t-stat both still positive/significant)" : "NO — degrades below the promote bar at pessimistic costs"}\n`);

// ======================================================================
// JSON sink
// ======================================================================
const DIR = fileURLToPath(new URL("./scans/", import.meta.url));
mkdirSync(DIR, { recursive: true });
const outFile = `${DIR}stress-meanrev-${end}.json`;
const report = {
  generated: {
    generatedAt: new Date().toISOString(),
    gitSha: gitSha(),
    dataProvider: "Alpaca SIP daily bars (backtest) + FMP screener (broad universe)",
    feed: "sip",
    adjustment: "split",
    barTimeframe: "1Day",
    dateRange: `${start}..${end}`,
    handpicked87Baseline: "tools/router/scans/validation-meanrev-*.json (pre-regime-filter: OUT t=3.39, PF~1.36-1.48, ~65% win)",
  },
  config: {
    mrRsiEntry: THRESH.mrRsiEntry, mrRsiPeriod: THRESH.mrRsiPeriod, smaTrend: THRESH.smaRegime,
    mrExitSma: THRESH.mrExitSma, mrMaxHold: THRESH.mrMaxHold, minPrice: THRESH.minPrice,
    minDollarVolM: THRESH.minDollarVolM, costRoundTripBase: COST_BASE, maxConcurrent: MAX_CONCURRENT,
    weightPerSlot: WEIGHT_PER_SLOT, regimeFilterEnabled: useRegime, mrRegimeSMA: THRESH.mrRegimeSMA,
    regimeFilterSymbol: "SPY",
  },
  caveats: [
    "STRESS 1/2/3 use the FMP screener's CURRENT constituents — this removes hand-picked-87 CURATION bias but not full survivorship bias: delisted/bankrupt/acquired names during 2021-2026 are absent from this universe too.",
    `broad universe capped from ${rawUniverse.length} to top ${BROAD_CAP} names by FMP screener order (data.mjs documents this as market-cap-descending); not independently re-verified here.`,
    "STRESS 2 sizes each slot at a FIXED 1/maxConcurrent (10%) regardless of how many slots are actually filled that day — unused slots hold cash at 0% return. This is a capacity-constrained-capital convention, not a claim about how the strategy would actually be sized live.",
    "STRESS 4's '2/5/10bps' use the standard 1bp=0.0001 definition; this differs from validate.mjs's own COST=0.0004 constant, which that file labels '2bps round-trip' but which numerically equals 4bps under the same standard definition. Both are reported.",
    useRegime
      ? "REGIME FILTER (default ON, --no-regime to disable): all four stresses below (1/2/3/4) run WITH the SPY.close>SPY.SMA(mrRegimeSMA) entry gate applied — they show the AFTER picture relative to the pre-regime-filter baseline referenced above."
      : "REGIME FILTER: disabled via --no-regime for this run — all four stresses below show the BEFORE picture (no SPY trend gate on entries).",
  ],
  stress1_broaderUniverse: {
    rawScreenerCount: rawUniverse.length, cappedTo: capped ? BROAD_CAP : rawUniverse.length,
    usableSymbolCount: symData.size, tradeCount: nBroad, midDate: midDateBroad,
    scorecard: rowsBroad, wouldPromoteUnderSameGateAsValidateMjs: wouldPromoteBroad, gateReasons,
  },
  stress2_portfolioCorrelationSim: {
    maxConcurrent: MAX_CONCURRENT, weightPerSlot: WEIGHT_PER_SLOT,
    simulatedWindow: `${firstCandidateDate}..${simDates[simDates.length - 1] ?? "-"}`, tradingDaysSimulated: nSimDays,
    cagrPct, maxDrawdownPct, sharpeAnnualized: sharpeAnn,
    avgHeldPositions: avgHeld, maxHeldPositions: maxHeld,
    avgSignalDemand: avgDemand, maxSignalDemand: maxDemand,
    finalEquityMultiple: finalEquity,
  },
  stress3_regimeSplit: { years: yearRows, bear2022Negative: !!bearFlag },
  stress4_costSensitivity: { baseline: baselineRow, sweep: costRows, survivesAt10bps },
};
writeFileSync(outFile, JSON.stringify(report, null, 2));
console.log(`saved -> ${outFile}\n`);
