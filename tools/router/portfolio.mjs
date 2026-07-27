// Strategy Router — PORTFOLIO backtest: institutional risk-sized book simulation.
// Replaces naive equal-weight per-trade % (breakdown.mjs) with real portfolio
// accounting: risk-based position sizing (shares sized off stop distance, not a
// fixed dollar slot), a real starting-capital equity curve, concurrent + sector
// caps, gross-exposure/notional caps, R-multiples, and true max-drawdown.
// Consumes the router's OWN signals (classify.mjs's metricPack/route) day-by-day
// over [--from,--to] and simulates a real book. Run:
//   node --env-file=.env tools/router/portfolio.mjs --from=2026-06-01 --to=2026-06-30 [--json]
//
// EXIT LOGIC — reused exactly from breakdown.mjs's chandelier/RSI2 pattern, with
// one addition (MeanRev's ATR hard stop, new for this harness — see below):
//   TrendRider = chandelier ATR(22)x3.5 trailing stop (matches Trend_Rider.pine).
//   MeanRev    = close>SMA5 OR mrMaxHold(10d) time-stop OR a FIXED (not trailing)
//                2.5xATR(14) hard stop set once at entry — whichever fires first.
//
// FILL CONVENTION — signal at close[D], fill at open[D+1], for BOTH exits and
// entries (no same-bar fills anywhere). Each iteration of the day loop below:
//   (A) fills exits scheduled from YESTERDAY's close-signal, at TODAY's open —
//       freeing capital/slot/sector count
//   (B) fills entries scheduled from YESTERDAY's close-signal, at TODAY's open —
//       using the capacity just freed by (A)
//   (C) marks the book to market at TODAY's close -> equity curve point
//   (D) evaluates EXIT signals for the (now current) open book at TODAY's close,
//       scheduling fills for TOMORROW — this runs for every day through the end
//       of the fetched window, even past --to ("keep processing exits after `to`
//       until all positions close or data ends")
//   (E) ONLY while date <= --to: evaluates NEW entry candidates via route() at
//       TODAY's close (SPY-regime + earnings-blackout computed per day, exactly
//       as the live router does it), ranks them, and reserves tomorrow's fills
//       against caps computed on the POST-(A) book (tomorrow's expected capacity)
//
// Leak-free by construction: every route()/metricPack() call only ever sees
// bars[0..idx] for the day being evaluated; every fill uses the NEXT bar's open.
import { alpacaBars, fmpEarnings, gitSha } from "../research/lib/data.mjs";
import { daysBefore } from "../research/lib/dates.mjs";
import { UNIVERSE, THRESH, LANES, PORTFOLIO, SECTOR } from "./config.mjs";
import { metricPack, route } from "./classify.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function requireCreds() {
  const missing = [
    !process.env.ALPACA_API_KEY_ID && "ALPACA_API_KEY_ID",
    !process.env.ALPACA_API_SECRET_KEY && "ALPACA_API_SECRET_KEY",
    !process.env.FMP_API_KEY && "FMP_API_KEY", // earnings-blackout gate needs this, same as scan.mjs/validate.mjs meanrev
  ].filter(Boolean);
  if (missing.length) throw new Error(`missing env credentials: ${missing.join(", ")}`);
}

// ---- args --------------------------------------------------------------------
const from = process.argv.find((a) => a.startsWith("--from="))?.split("=")[1];
const to = process.argv.find((a) => a.startsWith("--to="))?.split("=")[1] ?? from;
const asJson = process.argv.includes("--json");
if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
  throw new Error("usage: node --env-file=.env tools/router/portfolio.mjs --from=YYYY-MM-DD --to=YYYY-MM-DD [--json]");
if (to < from) throw new Error(`--to (${to}) is before --from (${from})`);

const COST = 0.0004; // 2bps round-trip, same convention/constant as breakdown.mjs/validate.mjs — deducted once, on exit, from entry notional

// ---- bar-series helpers — reused verbatim (parameterized) from breakdown.mjs ---
const sortB = (raw) => [...raw].sort((a, b) => (a.t < b.t ? -1 : 1));
function atrSeries(b, len) {
  const n = b.length, tr = new Array(n);
  tr[0] = b[0].h - b[0].l;
  for (let i = 1; i < n; i++) tr[i] = Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c));
  const out = new Array(n).fill(null);
  let prev;
  for (let i = len - 1; i < n; i++) {
    if (i === len - 1) { let s = 0; for (let k = 0; k < len; k++) s += tr[k]; prev = s / len; }
    else prev = (prev * (len - 1) + tr[i]) / len;
    out[i] = prev;
  }
  return out;
}
function smaSeries(b, len) {
  const n = b.length, out = new Array(n).fill(null);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += b[i].c;
    if (i >= len) sum -= b[i - len].c;
    if (i >= len - 1) out[i] = sum / len;
  }
  return out;
}

// ---- stats helpers (same conventions as validate.mjs/stress.mjs) --------------
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
function profitFactor(vals) {
  const wins = vals.filter((x) => x > 0).reduce((s, x) => s + x, 0);
  const lossSum = vals.filter((x) => x <= 0).reduce((s, x) => s + x, 0);
  if (lossSum === 0) return wins > 0 ? Infinity : 0;
  return wins / -lossSum;
}
const pfStr = (v) => (v === 0 ? "0.00" : Number.isFinite(v) ? v.toFixed(2) : "∞");

// ---- fetch ---------------------------------------------------------------------
const fetchStart = daysBefore(from, 430); // ~14mo warm-up for SMA200/52w, same floor as scan.mjs
const fetchEnd = daysBefore(to, -60);     // 60 calendar days PAST `to` to let exits resolve
requireCreds();
console.log(`\nStrategy Router — PORTFOLIO backtest  signals ${from}..${to}  ·  data ${fetchStart}..${fetchEnd}  ·  ${UNIVERSE.length} names\n`);

const bars = await alpacaBars([...UNIVERSE, "SPY"], "1Day", fetchStart, fetchEnd, "portfolio", 24);

function baseData(raw) {
  const b = sortB(raw);
  const dateIdx = new Map();
  b.forEach((bar, i) => dateIdx.set(bar.t.slice(0, 10), i));
  return { b, dateIdx };
}
const spyRaw = bars.get("SPY");
if (!spyRaw || spyRaw.length < 253) throw new Error(`SPY bars insufficient (${spyRaw ? spyRaw.length : 0}) — cannot compute regime`);
const spyData = baseData(spyRaw);

const symData = new Map();
const missingSymbols = [];
for (const sym of UNIVERSE) {
  const raw = bars.get(sym);
  if (!raw || raw.length < 253) { missingSymbols.push(sym); continue; }
  const base = baseData(raw);
  symData.set(sym, {
    ...base,
    atr22: atrSeries(base.b, PORTFOLIO.trendStopAtr),
    atr14: atrSeries(base.b, PORTFOLIO.meanrevStopAtr),
    sma5: smaSeries(base.b, THRESH.mrExitSma),
  });
}
if (missingSymbols.length)
  console.error(`portfolio: ${missingSymbols.length} symbol(s) excluded (insufficient bars): ${missingSymbols.join(", ")}`);

function spyRegimeAsOf(date) {
  const idx = spyData.dateIdx.get(date);
  if (idx == null || idx < 252) return false;
  const m = metricPack(spyData.b.slice(0, idx + 1));
  return m.sma200 != null && m.close > m.sma200;
}
async function blackoutSetFor(date) {
  const set = new Set();
  try {
    const earn = await fmpEarnings(date, daysBefore(date, -THRESH.mrEarningsBlackoutDays));
    const uniSet = new Set(UNIVERSE);
    for (const rec of earn) { const s = rec.slice(rec.lastIndexOf("|") + 1); if (uniSet.has(s)) set.add(s); }
  } catch (e) {
    console.error(`earnings blackout fetch failed for ${date} (${e.message}) — treating as empty this day`);
  }
  return set;
}

// ---- simulation timeline: every SPY trading day from `from` through the last
// fetched bar. Entries only generated for date<=to; exits processed every day. --
const timeline = spyData.b.map((b) => b.t.slice(0, 10)).filter((d) => d >= from);
if (!timeline.length) throw new Error(`no trading days on/after ${from} in fetched SPY data`);

// ---- portfolio state -----------------------------------------------------------
let cash = PORTFOLIO.startEquity;
const open = new Map();      // sym -> position
let pendingExits = [];       // [{sym, reason}] scheduled from yesterday's close-signal, fill at today's open
let pendingEntries = [];     // [{sym, lane, sector, shares, stopDist, riskDollar}] fill at today's open
const equityCurve = [];      // [{date, equity, cash, positionsValue, openCount}]
const blotter = [];
const skipped = { maxConcurrent: 0, maxPerSector: 0, grossExposure: 0, zeroShares: 0, alreadyOpen: 0 };

for (let ti = 0; ti < timeline.length; ti++) {
  const date = timeline[ti];

  // (A) fill exits scheduled from yesterday, at today's open — realize P&L -----
  for (const pe of pendingExits) {
    const pos = open.get(pe.sym);
    if (!pos) continue;
    const bd = symData.get(pe.sym);
    const idx = bd.dateIdx.get(date);
    const exitPrice = idx != null ? bd.b[idx].o : pos.lastClose;
    const pnlDollar = pos.shares * (exitPrice - pos.entry) - COST * pos.shares * pos.entry;
    cash += pos.shares * exitPrice - COST * pos.shares * pos.entry;
    blotter.push({
      sym: pe.sym, lane: pos.lane, status: LANES[pos.lane].status, sector: pos.sector,
      entryDate: pos.entryDate, entry: pos.entry, exitDate: date, exit: exitPrice,
      shares: pos.shares, riskDollar: pos.riskDollar, pnlDollar, R: pos.riskDollar > 0 ? pnlDollar / pos.riskDollar : null,
      pctEquity: pos.equityAtEntry > 0 ? (pnlDollar / pos.equityAtEntry) * 100 : null,
      exitReason: pe.reason, tradeStatus: "closed",
    });
    open.delete(pe.sym);
  }
  pendingExits = [];

  // (B) fill entries scheduled from yesterday, at today's open ----------------
  for (const pe of pendingEntries) {
    const bd = symData.get(pe.sym);
    const idx = bd.dateIdx.get(date);
    if (idx == null) continue; // no bar today for this symbol — drop the fill (rare)
    const entryPrice = bd.b[idx].o;
    if (!(entryPrice > 0)) continue;
    cash -= pe.shares * entryPrice;
    open.set(pe.sym, {
      sym: pe.sym, lane: pe.lane, sector: pe.sector, entryIdx: idx, entryDate: date, entry: entryPrice,
      shares: pe.shares, riskDollar: pe.riskDollar, stopDist: pe.stopDist,
      hh: bd.b[idx].h, trail: -Infinity,
      stopPrice: pe.lane === "MeanRev" ? entryPrice - pe.stopDist : null,
      lastClose: entryPrice, equityAtEntry: null, // stamped just below once equityNow is known
    });
  }
  pendingEntries = [];

  // (C) mark to market at today's close -----------------------------------------
  let positionsValue = 0;
  for (const [sym, pos] of open) {
    const bd = symData.get(sym);
    const idx = bd.dateIdx.get(date);
    const px = idx != null ? bd.b[idx].c : pos.lastClose;
    if (idx != null) pos.lastClose = px;
    positionsValue += pos.shares * px;
  }
  const equityNow = cash + positionsValue;
  for (const [, pos] of open) if (pos.equityAtEntry == null) pos.equityAtEntry = equityNow;
  equityCurve.push({ date, equity: equityNow, cash, positionsValue, openCount: open.size });

  // (D) evaluate EXIT signals for the current book at today's close, schedule
  // fills for tomorrow — runs every day, including past `to`. ------------------
  for (const [sym, pos] of open) {
    const bd = symData.get(sym);
    const idx = bd.dateIdx.get(date);
    if (idx == null) continue;
    let fire = false, reason = null;
    if (pos.lane === "TrendRider") {
      pos.hh = Math.max(pos.hh, bd.b[idx].h);
      const atr = bd.atr22[idx];
      if (atr != null) pos.trail = Math.max(pos.trail, pos.hh - PORTFOLIO.trendStopMult * atr);
      if (pos.trail > -Infinity && bd.b[idx].c < pos.trail) { fire = true; reason = "chandelier"; }
    } else { // MeanRev
      const heldDays = idx - pos.entryIdx;
      const sma5v = bd.sma5[idx];
      if (sma5v != null && bd.b[idx].c > sma5v) { fire = true; reason = "reversion"; }
      else if (heldDays >= THRESH.mrMaxHold) { fire = true; reason = "timeStop"; }
      else if (pos.stopPrice != null && bd.b[idx].c <= pos.stopPrice) { fire = true; reason = "hardStop"; }
    }
    if (fire) pendingExits.push({ sym, reason });
  }

  // (E) ONLY within [from,to] and only if there's a next day to fill on: generate
  // new entry candidates via the router's own route(), rank, and reserve slots
  // against tomorrow's expected capacity (today's book minus today's scheduled
  // exits) — "exits first" frees capital/slot/sector count for these entries. ---
  if (date <= to && ti < timeline.length - 1) {
    const regimeOK = spyRegimeAsOf(date);
    const blackout = await blackoutSetFor(date);
    const cands = [];
    for (const sym of UNIVERSE) {
      if (open.has(sym)) { skipped.alreadyOpen++; continue; }
      const bd = symData.get(sym);
      if (!bd) continue;
      const idx = bd.dateIdx.get(date);
      if (idx == null || idx < 252) continue; // needs >=253 bars for SMA200, same floor as scan.mjs
      const m = metricPack(bd.b.slice(0, idx + 1));
      const r = route(m, regimeOK, blackout.has(sym));
      if (r.strategy === "TrendRider" && r.signal === "breakout")
        cands.push({ sym, lane: "TrendRider", sector: SECTOR[sym] ?? "Unknown", rankVal: m.pctVs20dHigh ?? -1e9, atrVal: bd.atr22[idx], closePx: m.close });
      else if (r.strategy === "MeanRev")
        cands.push({ sym, lane: "MeanRev", sector: SECTOR[sym] ?? "Unknown", rankVal: m.rsi2 ?? 1e9, atrVal: bd.atr14[idx], closePx: m.close });
    }
    const trendCands = cands.filter((c) => c.lane === "TrendRider").sort((a, b) => b.rankVal - a.rankVal);
    const mrCands = cands.filter((c) => c.lane === "MeanRev").sort((a, b) => a.rankVal - b.rankVal);
    const ranked = [...trendCands, ...mrCands];

    // provisional book = today's open positions MINUS today's scheduled exits
    // (which fill, freeing capacity, before tomorrow's entries do)
    const provOpen = new Map();
    for (const [sym, pos] of open) provOpen.set(sym, { sector: pos.sector, notional: pos.shares * pos.lastClose });
    for (const pe of pendingExits) provOpen.delete(pe.sym);

    for (const c of ranked) {
      const stopDist = c.lane === "TrendRider" ? PORTFOLIO.trendStopMult * c.atrVal : PORTFOLIO.meanrevStopMult * c.atrVal;
      if (!(stopDist > 0) || !(c.closePx > 0)) { skipped.zeroShares++; continue; }
      const riskBudget = PORTFOLIO.riskPctPerTrade * equityNow;
      let shares = Math.floor(riskBudget / stopDist);
      if (shares <= 0) { skipped.zeroShares++; continue; }
      const maxNotional = PORTFOLIO.maxNotionalPct * equityNow;
      let notional = shares * c.closePx;
      if (notional > maxNotional) { shares = Math.floor(maxNotional / c.closePx); notional = shares * c.closePx; }
      if (shares <= 0) { skipped.zeroShares++; continue; }

      if (provOpen.size >= PORTFOLIO.maxConcurrent) { skipped.maxConcurrent++; continue; }
      const sectorCount = [...provOpen.values()].filter((p) => p.sector === c.sector).length;
      if (sectorCount >= PORTFOLIO.maxPerSector) { skipped.maxPerSector++; continue; }
      const grossNotional = [...provOpen.values()].reduce((s, p) => s + p.notional, 0);
      if ((grossNotional + notional) / equityNow > PORTFOLIO.maxGrossExposure) { skipped.grossExposure++; continue; }

      provOpen.set(c.sym, { sector: c.sector, notional });
      pendingEntries.push({ sym: c.sym, lane: c.lane, sector: c.sector, shares, stopDist, riskDollar: shares * stopDist });
    }
  }
}

// ---- finalize: any position still open when data ends -> mark-to-market row ---
const lastDate = timeline[timeline.length - 1];
for (const [sym, pos] of open) {
  const bd = symData.get(sym);
  const idx = bd.dateIdx.get(lastDate);
  const lastPx = idx != null ? bd.b[idx].c : pos.lastClose;
  const pnlDollar = pos.shares * (lastPx - pos.entry); // unrealized — no round-trip cost yet, matches breakdown.mjs's "open" convention
  blotter.push({
    sym, lane: pos.lane, status: LANES[pos.lane].status, sector: pos.sector,
    entryDate: pos.entryDate, entry: pos.entry, exitDate: lastDate, exit: lastPx,
    shares: pos.shares, riskDollar: pos.riskDollar, pnlDollar, R: pos.riskDollar > 0 ? pnlDollar / pos.riskDollar : null,
    pctEquity: pos.equityAtEntry > 0 ? (pnlDollar / pos.equityAtEntry) * 100 : null,
    exitReason: "dataEnd", tradeStatus: "open",
  });
}

// ---- metrics --------------------------------------------------------------------
const finalEquity = equityCurve.length ? equityCurve[equityCurve.length - 1].equity : PORTFOLIO.startEquity;
const totalReturnPct = (finalEquity - PORTFOLIO.startEquity) / PORTFOLIO.startEquity * 100;
let peak = -Infinity, maxDD = 0;
for (const pt of equityCurve) { peak = Math.max(peak, pt.equity); maxDD = Math.min(maxDD, (pt.equity - peak) / peak); }
const maxDrawdownPct = maxDD * 100;

function scorecard(trades) {
  const n = trades.length;
  const pnls = trades.map((t) => t.pnlDollar);
  const rs = trades.map((t) => t.R).filter((r) => r != null);
  return {
    tradeCount: n,
    winRatePct: n ? (trades.filter((t) => t.pnlDollar > 0).length / n) * 100 : 0,
    avgR: rs.length ? mean(rs) : 0,
    profitFactor: profitFactor(pnls),
    totalPnlDollar: pnls.reduce((s, x) => s + x, 0),
  };
}
const overall = scorecard(blotter);
const liveTrades = blotter.filter((t) => t.status === "LIVE");
const paperTrades = blotter.filter((t) => t.status === "PAPER");
const liveOnly = scorecard(liveTrades);
const liveAndPaper = overall;

const avgConcurrent = mean(equityCurve.map((p) => p.openCount));
const maxConcurrentSeen = equityCurve.length ? Math.max(...equityCurve.map((p) => p.openCount)) : 0;
const avgGrossExposurePct = mean(equityCurve.map((p) => (p.equity > 0 ? (p.positionsValue / p.equity) * 100 : 0)));
const maxGrossExposurePct = equityCurve.length ? Math.max(...equityCurve.map((p) => (p.equity > 0 ? (p.positionsValue / p.equity) * 100 : 0))) : 0;
const skippedTotal = Object.values(skipped).reduce((s, x) => s + x, 0);

// ---- console report ---------------------------------------------------------
console.log(`config: startEquity=$${PORTFOLIO.startEquity.toLocaleString()}  riskPctPerTrade=${(PORTFOLIO.riskPctPerTrade * 100).toFixed(1)}%  maxConcurrent=${PORTFOLIO.maxConcurrent}  maxPerSector=${PORTFOLIO.maxPerSector}  maxNotionalPct=${(PORTFOLIO.maxNotionalPct * 100).toFixed(0)}%  maxGrossExposure=${(PORTFOLIO.maxGrossExposure * 100).toFixed(0)}%`);
console.log(`stops: TrendRider chandelier ${PORTFOLIO.trendStopMult}x ATR(${PORTFOLIO.trendStopAtr}) trailing  ·  MeanRev fixed ${PORTFOLIO.meanrevStopMult}x ATR(${PORTFOLIO.meanrevStopAtr}) hard stop (or SMA5 reversion / ${THRESH.mrMaxHold}d time-stop)\n`);

console.log(`finalEquity        $${finalEquity.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
console.log(`totalReturn        ${totalReturnPct.toFixed(2)}%`);
console.log(`maxDrawdown        ${maxDrawdownPct.toFixed(2)}%`);
console.log(`winRate            ${overall.winRatePct.toFixed(1)}%`);
console.log(`avgR (expectancy)  ${overall.avgR.toFixed(3)}R`);
console.log(`profitFactor       ${pfStr(overall.profitFactor)}`);
console.log(`tradeCount         ${overall.tradeCount}  (${liveTrades.length} LIVE / ${paperTrades.length} PAPER)`);
console.log(`skippedByCaps      ${skippedTotal}  ${JSON.stringify(skipped)}`);
console.log(`avg/max concurrent ${avgConcurrent.toFixed(2)} / ${maxConcurrentSeen}`);
console.log(`avg/max grossExp%  ${avgGrossExposurePct.toFixed(1)}% / ${maxGrossExposurePct.toFixed(1)}%\n`);

console.log(`LIVE-only (TrendRider):     n=${liveOnly.tradeCount}  win=${liveOnly.winRatePct.toFixed(1)}%  avgR=${liveOnly.avgR.toFixed(3)}  PF=${pfStr(liveOnly.profitFactor)}  pnl=$${liveOnly.totalPnlDollar.toFixed(0)}`);
console.log(`LIVE+PAPER (all lanes):     n=${liveAndPaper.tradeCount}  win=${liveAndPaper.winRatePct.toFixed(1)}%  avgR=${liveAndPaper.avgR.toFixed(3)}  PF=${pfStr(liveAndPaper.profitFactor)}  pnl=$${liveAndPaper.totalPnlDollar.toFixed(0)}\n`);

const bline = (t) =>
  `  ${t.sym.padEnd(6)} ${t.lane.padEnd(10)} ${t.sector.padEnd(11)} ${t.entryDate} $${t.entry.toFixed(2).padStart(9)} -> ${t.exitDate} $${t.exit.toFixed(2).padStart(9)}` +
  `  sh=${String(t.shares).padStart(5)}  risk=$${t.riskDollar.toFixed(0).padStart(6)}  pnl=$${t.pnlDollar.toFixed(0).padStart(7)}  R=${t.R != null ? t.R.toFixed(2).padStart(6) : "   n/a"}  %eq=${t.pctEquity != null ? t.pctEquity.toFixed(2).padStart(6) : "  n/a"}  [${t.exitReason}/${t.tradeStatus}]`;
console.log(`blotter (${blotter.length} trades):`);
blotter.forEach((t) => console.log(bline(t)));
console.log("");

// ---- JSON sink -------------------------------------------------------------
const DIR = fileURLToPath(new URL("./scans/", import.meta.url));
mkdirSync(DIR, { recursive: true });
const outFile = `${DIR}portfolio-${from}_${to}.json`;
const report = {
  generated: {
    generatedAt: new Date().toISOString(),
    gitSha: gitSha(),
    dataProvider: "Alpaca SIP daily bars (backtest) + FMP earnings calendar (blackout)",
    feed: "sip", adjustment: "split", barTimeframe: "1Day",
    universeCount: UNIVERSE.length, excludedSymbols: missingSymbols,
    signalRange: `${from}..${to}`, fetchRange: `${fetchStart}..${fetchEnd}`,
    simulatedThrough: lastDate,
  },
  config: { ...PORTFOLIO, costRoundTrip: COST, mrExitSma: THRESH.mrExitSma, mrMaxHold: THRESH.mrMaxHold },
  leakAvoidance: [
    "every route()/metricPack() call for day D uses bars[0..D] only — nothing later is ever read",
    "SPY regime and the earnings-blackout set are recomputed fresh for every signal day D, exactly as scan.mjs computes them live",
    "entries and exits both FILL at the NEXT trading day's open relative to the close where the signal fired — never a same-bar fill",
    "TrendRider exit = chandelier ATR(22)x3.5 trailing stop (daily-updated ATR/highest-high, reused verbatim from breakdown.mjs)",
    "MeanRev exit = close>SMA(5) OR held>=mrMaxHold(10d) OR close<=fixed hard stop (entry - 2.5*ATR(14) AT ENTRY, not trailing) — whichever fires first",
    "position sizing uses ATR as of the SIGNAL day's close (same bar route() evaluated), shares=floor(riskBudget/stopDist), riskBudget=riskPctPerTrade*equityNow(that day) — then capped by maxNotionalPct and maxGrossExposure",
    "caps (maxConcurrent/maxPerSector/maxGrossExposure) for tomorrow's entries are checked against the book AS IT WILL BE after today's already-scheduled exits clear — 'exits first' frees capacity before entries claim it",
    "exit-signal evaluation continues every day through the end of the fetched window (fetchEnd = to+60d) even past --to; only NEW entries are gated to date<=--to",
  ],
  metrics: {
    finalEquity, totalReturnPct, maxDrawdownPct,
    winRatePct: overall.winRatePct, avgR: overall.avgR, profitFactor: Number.isFinite(overall.profitFactor) ? overall.profitFactor : null,
    tradeCount: overall.tradeCount, skippedByCaps: { total: skippedTotal, ...skipped },
    avgConcurrent, maxConcurrentSeen, avgGrossExposurePct, maxGrossExposurePct,
  },
  liveVsPaper: {
    liveOnly: { ...liveOnly, profitFactor: Number.isFinite(liveOnly.profitFactor) ? liveOnly.profitFactor : null },
    liveAndPaper: { ...liveAndPaper, profitFactor: Number.isFinite(liveAndPaper.profitFactor) ? liveAndPaper.profitFactor : null },
  },
  equityCurve,
  blotter,
};
if (asJson) {
  writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`saved -> ${outFile}\n`);
} else {
  console.log(`(pass --json to also write ${outFile})\n`);
}
