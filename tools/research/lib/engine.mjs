// Scanner + strategy engines, instrumented with per-symbol gate telemetry.
// Rules are the faithful twins of tools/pine/morning_scan_jumpday_long.pine
// (rider) and morning_scan_largecap_scalper.pine (scalper) — see
// research/parity-audit.md. Any rule change here MUST be mirrored in Pine.

export const THRESHOLDS = {
  gap: 1.5, rangeDay: 2, mtdMin: 7, pmDollarMin: 2e6, priceCeil: 150,
  riderRange: 6.5, riderPriceFloor: 20, scalperDollarVol: 8e9, cautionRange: 4.5,
  finalists: 30, boardN: 12, eligibleN: 5,
};

const round = (n, p = 2) => Math.round(n * 10 ** p) / 10 ** p;
const clamp01 = (n) => Math.max(0, Math.min(1, n));

export function classify(avgRange, dollarVol, price) {
  const T = THRESHOLDS;
  if (avgRange != null && avgRange >= T.riderRange && price >= T.riderPriceFloor) return "rider";
  if (dollarVol != null && dollarVol >= T.scalperDollarVol) return "scalper";
  if (avgRange == null) return null;
  if (avgRange >= T.cautionRange) return "caution";
  return "avoid";
}

/** Point-in-time board for one day with FULL gate telemetry.
 * Every universe symbol gets a record; every gate logs pass/fail + the value
 * that decided it. Reason codes downstream come from these logs, not inference.
 * dayBarsMap: full-session 5m bars (04:00-20:00 ET) with .hm precomputed. */
export function scanDay({ day, dailies, dayBarsMap, earnSet }) {
  const T = THRESHOLDS;
  const telemetry = new Map();
  const cands = [];
  for (const [sym, all] of dailies) {
    const rec = { sym, gates: [], lifecycle: "visible" };
    telemetry.set(sym, rec);
    const gate = (name, pass, value) => { rec.gates.push({ gate: name, pass, value }); return pass; };

    const hist = all.filter((b) => b.t.slice(0, 10) < day);
    if (!gate("history_30d", hist.length >= 30, hist.length)) { rec.lifecycle = "excluded"; continue; }
    const prevClose = hist[hist.length - 1].c;
    const bars = dayBarsMap.get(sym) ?? [];
    const pms = bars.filter((b) => b.hm >= "04:00" && b.hm <= "08:30"); // scan cutoff 08:30
    const price = pms.length ? pms[pms.length - 1].c : prevClose;
    const gap = ((price - prevClose) / prevClose) * 100;
    const pmDollar = pms.reduce((s, b) => s + b.v * b.c, 0);
    const last10 = hist.slice(-10);
    const mtd = last10.filter((b) => ((b.h - b.l) / b.c) * 100 >= T.rangeDay).length;
    const avgRange = last10.reduce((s, b) => s + ((b.h - b.l) / b.c) * 100, 0) / last10.length;
    const vol20 = hist.slice(-20).reduce((s, b) => s + b.v, 0) / Math.min(20, hist.length);
    const dollarVol = vol20 * prevClose;
    const tr = [];
    for (let i = Math.max(1, hist.length - 14); i < hist.length; i++)
      tr.push(Math.max(hist[i].h - hist[i].l, Math.abs(hist[i].h - hist[i - 1].c), Math.abs(hist[i].l - hist[i - 1].c)));
    const atrPct = tr.length ? (tr.reduce((a, b) => a + b, 0) / tr.length / price) * 100 : null;
    const cls = classify(avgRange, dollarVol, price);
    const hasEarn = earnSet.has(`${day}|${sym}`);
    const volatility = 0.55 * clamp01(mtd / 8) + 0.45 * clamp01((atrPct ?? 1.5) / 5);
    const liquidity = clamp01(Math.log10(Math.max(dollarVol, 1)) / Math.log10(5e9));
    const score = round(100 * (0.4 * volatility + 0.25 * liquidity + 0.15 * clamp01(Math.abs(gap) / 5) + 0.2 * (hasEarn ? 0.5 : 0)), 1);

    Object.assign(rec, {
      price: round(price), gap: round(gap), pmDollar: Math.round(pmDollar), mtd,
      avgRange: round(avgRange, 1), dollarVol: Math.round(dollarVol),
      atrPct: atrPct != null ? round(atrPct) : null, hasEarn, score, cls, prevClose,
    });
    // Per-class ceiling: only the scalper class trades above $150 (its Pine has no ceiling).
    if (!gate("price_ceiling", !(rec.price > T.priceCeil && cls !== "scalper"), rec.price)) { rec.lifecycle = "excluded"; continue; }
    rec.lifecycle = "candidate";
    cands.push(rec);
  }

  const prelimScore = (c) => Math.abs(c.gap) + (c.hasEarn ? 2 : 0) + clamp01(Math.log10(Math.max(c.dollarVol, 1) / 1e8));
  cands.sort((a, b) => prelimScore(b) - prelimScore(a));
  cands.forEach((c, i) => {
    c.prelimRank = i + 1;
    c.gates.push({ gate: "prelim_rank_top30", pass: i < T.finalists, value: i + 1 });
    if (i < T.finalists) c.lifecycle = "finalist";
  });
  const finalists = cands.slice(0, T.finalists);

  for (const c of finalists) {
    const badge = c.gates.push({ gate: "badge", pass: c.cls === "rider" || c.cls === "scalper", value: c.cls }) &&
      (c.cls === "rider" || c.cls === "scalper");
    const mtdOk = badge && (c.gates.push({ gate: "mtd_min7", pass: c.mtd >= T.mtdMin, value: c.mtd }), c.mtd >= T.mtdMin);
    const pmOk = mtdOk && (c.gates.push({ gate: "pm_dollar_2m", pass: c.pmDollar >= T.pmDollarMin, value: c.pmDollar }), c.pmDollar >= T.pmDollarMin);
    if (pmOk) c.lifecycle = "qualified";
  }
  const qualified = finalists.filter((c) => c.lifecycle === "qualified").sort((a, b) => b.score - a.score);
  qualified.forEach((c, i) => {
    c.gates.push({ gate: "top5_score", pass: i < T.eligibleN, value: c.score });
    if (i < T.eligibleN) c.lifecycle = "eligible";
  });

  return {
    day, telemetry,
    top: [...finalists].sort((a, b) => b.score - a.score).slice(0, T.boardN),
    jump: finalists.filter((c) => c.gap >= T.gap).sort((a, b) => b.gap - a.gap).slice(0, T.boardN),
    fall: finalists.filter((c) => c.gap <= -T.gap).sort((a, b) => a.gap - b.gap).slice(0, T.boardN),
    eligible: qualified.slice(0, T.eligibleN),
  };
}

/** Intrabar exit resolution when stop AND target are both inside the bar.
 * tv_ohlc_path mirrors TradingView's emulator heuristic: price walks from open
 * to the NEARER extreme first, then the farther one. */
export function resolveIntrabar(bar, stop, tgt, fillMode) {
  const hitStop = bar.l <= stop, hitTgt = bar.h >= tgt;
  if (hitStop && hitTgt) {
    // Gap-through at the open is decisive and overrides fillMode: if the bar OPENED
    // already through a level, that level is touched first — the other is unreachable
    // before it. Without this, target_first books an impossible winning fill on a bar
    // that gapped down straight through the stop.
    if (bar.o <= stop) return "stop";
    if (bar.o >= tgt) return "target";
    if (fillMode === "target_first") return "target";
    if (fillMode === "tv_ohlc_path")
      return Math.abs(bar.o - bar.h) < Math.abs(bar.o - bar.l) ? "target" : "stop";
    return "stop"; // stop_first — conservative default
  }
  return hitStop ? "stop" : hitTgt ? "target" : null;
}

/** One (symbol, day) through the badge-matched engine. Fixed $25k, 1% risk. */
export function runEngine(cls, dayBars, prevClose, fillMode = "stop_first") {
  const T = THRESHOLDS;
  const cfg = cls === "rider"
    ? { maxTrades: 1, rr: null, liveCeil: true }
    : { maxTrades: 3, rr: 1.5, liveCeil: false };
  const EQ = 25000, riskPct = 1, notionalCap = 0.5, stopBuf = 0.8, commPct = 0.0002;
  const firstRth = dayBars.find((b) => b.hm >= "09:30");
  if (!firstRth) return { status: "no-session", trades: [] };
  const gap = ((firstRth.o - prevClose) / prevClose) * 100;
  if (gap <= -T.gap) return { status: "declined: fall day", gap: round(gap), trades: [] };
  if (gap < T.gap) return { status: `declined: gap +${round(gap)}% < ${T.gap}%`, gap: round(gap), trades: [] };
  const slip = Math.max(0.01, firstRth.o * 0.0003);
  const ema = (p, v, n) => { const k = 2 / (n + 1); return p == null ? v : v * k + p * (1 - k); };
  let cumPV = 0, cumV = 0, e9 = null, e20 = null, prev = null, pos = null, pending = null, lastRth = null;
  const trades = []; let nT = 0, dayPnl = 0;
  const record = (exit, exitHm, reason) => {
    const pnl = (exit - pos.entry) * pos.qty - (pos.entry + exit) * pos.qty * commPct;
    dayPnl += pnl; nT++;
    trades.push({ entryHm: pos.entryHm, exitHm, entry: round(pos.entry), exit: round(exit), qty: pos.qty, pnl: round(pnl), reason });
    pos = null;
  };
  for (const b of dayBars) {
    const tp = (b.h + b.l + b.c) / 3; cumPV += tp * b.v; cumV += b.v;
    const vwap = cumV > 0 ? cumPV / cumV : b.c;
    e9 = ema(e9, b.c, 9); e20 = ema(e20, b.c, 20);
    const rth = b.hm >= "09:30" && b.hm < "16:00";
    if (rth) lastRth = b;
    if (pending && rth) {
      const entry = b.o + slip;
      if (entry - pending.stop > 0 && pending.dist > 0) {
        const qty = Math.floor(Math.min((EQ * riskPct / 100) / pending.dist, (EQ * notionalCap) / entry));
        if (qty >= 1) pos = { entry, entryHm: b.hm, stop: pending.stop,
          tgt: cfg.rr ? entry + pending.dist * cfg.rr : Infinity, qty };
      }
      pending = null;
    }
    if (pos && rth) {
      const hit = resolveIntrabar(b, pos.stop, pos.tgt, fillMode);
      // Gap-through stop: if the bar OPENS at/below the stop, a stop-market order
      // fills at the (worse) open, not the stop price — never a price the tape
      // never traded. Pessimistic and matches how TradingView fills gap-throughs.
      if (hit === "stop") record(Math.min(b.o, pos.stop) - slip, b.hm, "stop");
      else if (hit === "target") record(pos.tgt, b.hm, "target");
      // EOD flatten is a market sell — take slippage like every other market exit.
      else if (b.hm >= "15:50") record(b.c - slip, b.hm, "eod");
    }
    // Session "0940-1100": end-exclusive — last signal bar 10:55, fill 11:00.
    const canSignal = rth && b.hm >= "09:40" && b.hm < "11:00" && !pos && !pending &&
      nT < cfg.maxTrades && dayPnl > -500;
    if (canSignal && prev) {
      const ceilOk = !cfg.liveCeil || b.c <= T.priceCeil;
      if (ceilOk && b.l <= e9 && b.c > e9 && b.c > vwap && e9 > e20) {
        const stop = Math.min(b.l, prev.l) - (stopBuf / 100) * b.c;
        pending = { stop, dist: b.c - stop }; // R-distance from the SIGNAL bar (Pine parity)
      }
    }
    prev = b;
  }
  if (pos && lastRth) record(lastRth.c - slip, lastRth.hm, "data-end"); // market sell — slipped
  return { status: trades.length ? "traded" : "qualified, no trigger", gap: round(gap), trades };
}
