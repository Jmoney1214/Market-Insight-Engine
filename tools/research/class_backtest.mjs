// Stock-class discovery + per-class engine backtests on Alpaca SIP bars.
// Engines mirror Pine v6 semantics: signal on bar close, fill next bar open,
// stop-before-target intrabar (pessimistic).
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const KEY = process.env.ALPACA_API_KEY_ID, SEC = process.env.ALPACA_API_SECRET_KEY;
const H = { "APCA-API-KEY-ID": KEY, "APCA-API-SECRET-KEY": SEC };
const CACHE = new URL("./cache/", import.meta.url).pathname;
mkdirSync(CACHE, { recursive: true });

// Cache key MUST include the window: keying on symbol+timeframe alone collides across
// date ranges, silently serving one window's bars for another (backtest-truth bug C1's sibling).
export function cacheKey(symbol, timeframe, start, end) {
  const d = (s) => String(s).slice(0, 10);
  return `${symbol}_${timeframe}_${d(start)}_${d(end)}.json`;
}

async function bars(symbol, timeframe, start, end) {
  const f = `${CACHE}${cacheKey(symbol, timeframe, start, end)}`;
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  let out = [], token;
  for (;;) {
    const u = new URL(`https://data.alpaca.markets/v2/stocks/${symbol}/bars`);
    Object.entries({ timeframe, start, end, limit: "10000", adjustment: "split", feed: "sip" })
      .forEach(([k, v]) => u.searchParams.set(k, v));
    if (token) u.searchParams.set("page_token", token);
    const r = await fetch(u, { headers: H });
    if (!r.ok) throw new Error(`${symbol} ${timeframe}: ${r.status}`);
    const j = await r.json();
    out = out.concat(j.bars ?? []);
    token = j.next_page_token;
    if (!token) break;
  }
  writeFileSync(f, JSON.stringify(out));
  return out;
}

const etParts = (iso) => {
  const s = new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const [date, time] = s.split(", ");
  const [mm, dd, yyyy] = date.split("/");
  return { day: `${yyyy}-${mm}-${dd}`, hm: time.slice(0, 5) };
};
const ema = (prev, v, n) => { const k = 2 / (n + 1); return prev == null ? v : v * k + prev * (1 - k); };

/** Pessimistic intrabar exit for a LONG position. Stop-before-target (matches Pine v6 semantics).
 * Returns { exit, reason } or null. Gap-through and slippage are modelled truthfully:
 *  - stop: if the bar OPENED at/below the stop, the stop price never traded — fill at the (worse)
 *    open. Then slip adverse. (Booking pos.stop on a gap-down understates losses -> inflates PF.)
 *  - flat: the time-flatten is a market SELL, so it must be slipped adverse like any exit
 *    (booking the raw close flatters every non-stopped exit by ~1 slip). */
export function resolveExit(bar, pos, slip, flatTime) {
  if (bar.l <= pos.stop) {
    const fill = Math.min(pos.stop, bar.o);   // gap-through -> the open, the price the tape traded
    return { exit: fill - slip, reason: "stop" };
  }
  if (bar.h >= pos.tgt) return { exit: pos.tgt, reason: "target" };   // limit sell fills at target
  if (bar.hm >= flatTime) return { exit: bar.c - slip, reason: "flat" };
  return null;
}

export async function features(symbol) {
  const daily = await bars(symbol, "1Day", "2025-05-01T00:00:00Z", "2026-07-02T23:59:00Z");
  const last60 = daily.slice(-60);
  const price = daily.at(-1).c;
  const avgRange = last60.reduce((s, b) => s + (b.h - b.l) / b.c * 100, 0) / last60.length;
  const dollarVol = last60.reduce((s, b) => s + b.v * b.c, 0) / last60.length;
  return { symbol, price: +price.toFixed(2), avgRange: +avgRange.toFixed(2), dollarVolM: Math.round(dollarVol / 1e6) };
}

// cfg: { rangeThresh, mtdMin, pmVolMin, gapUpMin (null=any non-fall day), fallThresh,
//        engine: "rider"|"scalper"|"orb", rr (scalper), maxTrades, stopBufPct,
//        entryFrom, entryTo, flatTime, riskPct, notionalCap, dayLoss, commPct, slipTicks }
export async function run(symbol, cfg) {
  const daily = await bars(symbol, "1Day", "2025-05-01T00:00:00Z", "2026-07-02T23:59:00Z");
  const intraday = await bars(symbol, "5Min", "2025-08-01T00:00:00Z", "2026-07-02T23:59:00Z");
  const mtdByDay = {}, prevCloseByDay = {};
  daily.forEach((b, i) => {
    const day = b.t.slice(0, 10);
    const win = daily.slice(Math.max(0, i - 10), i);
    mtdByDay[day] = win.filter(x => (x.h - x.l) / x.c * 100 >= cfg.rangeThresh).length;
    prevCloseByDay[day] = i > 0 ? daily[i - 1].c : null;
  });
  const byDay = new Map();
  for (const b of intraday) {
    const { day, hm } = etParts(b.t);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push({ ...b, hm });
  }

  let equity = 25000;
  const trades = [], dayStats = [];
  for (const [day, dbars] of byDay) {
    if ((mtdByDay[day] ?? 0) < cfg.mtdMin) continue;
    const prevClose = prevCloseByDay[day];
    if (!prevClose) continue;
    const pmVol = dbars.filter(b => b.hm >= "04:00" && b.hm < "09:30").reduce((s, b) => s + b.v * b.c, 0); // DOLLARS
    if (pmVol < cfg.pmVolMin) continue;
    const firstRth = dbars.find(b => b.hm >= "09:30");
    if (!firstRth) continue;
    const gap = (firstRth.o - prevClose) / prevClose * 100;
    if (gap <= -cfg.fallThresh) continue;                       // never long a fall day
    if (cfg.gapUpMin != null && gap < cfg.gapUpMin) continue;   // jump days only

    const slip = Math.max(0.01, firstRth.o * 0.0003);           // ~3 bps slippage, 1c floor
    let cumPV = 0, cumV = 0, e9 = null, e20 = null;
    let orH = null, orL = null, orDone = false, rthCount = 0;
    let pos = null, dayPnl = 0, nTrades = 0, nWins = 0, pending = null, prevBar = null;
    const book = (exit) => {
      const pnl = (exit - pos.entry) * pos.qty - (pos.entry + exit) * pos.qty * cfg.commPct;
      equity += pnl; dayPnl += pnl; nTrades++; if (pnl > 0) nWins++;
      trades.push({ day, pnl });
      pos = null;
    };
    for (const b of dbars) {
      const tp = (b.h + b.l + b.c) / 3;
      cumPV += tp * b.v; cumV += b.v;
      const vwap = cumV > 0 ? cumPV / cumV : b.c;
      e9 = ema(e9, b.c, 9); e20 = ema(e20, b.c, 20);
      const rth = b.hm >= "09:30" && b.hm < "16:00";
      if (rth) {
        rthCount++;
        if (rthCount <= 3) { orH = orH == null ? b.h : Math.max(orH, b.h); orL = orL == null ? b.l : Math.min(orL, b.l); }
        else orDone = true;
      }
      if (pending && rth) {
        const entry = b.o + slip;
        const stopDist = entry - pending.stop;
        if (stopDist > 0) {
          const riskCash = equity * cfg.riskPct / 100;
          const qty = Math.floor(Math.min(riskCash / stopDist, equity * cfg.notionalCap / entry));
          if (qty >= 1) pos = { entry, stop: pending.stop, tgt: pending.rr ? entry + stopDist * pending.rr : Infinity, qty };
        }
        pending = null;
      }
      if (pos && rth) {
        const ex = resolveExit(b, pos, slip, cfg.flatTime);
        if (ex) book(ex.exit);
      }
      const canSignal = rth && b.hm >= cfg.entryFrom && b.hm <= cfg.entryTo && !pos && !pending &&
        nTrades < cfg.maxTrades && dayPnl > -cfg.dayLoss;
      if (canSignal && prevBar) {
        if (cfg.engine === "orb") {
          if (orDone && b.c > orH && orL != null) pending = { stop: orL - cfg.stopBufPct / 100 * b.c, rr: cfg.rr || null };
        } else { // rider / scalper share the pullback trigger
          const tag = b.l <= e9 && b.c > e9 && b.c > vwap && e9 > e20;
          if (tag) pending = { stop: Math.min(b.l, prevBar.l) - cfg.stopBufPct / 100 * b.c, rr: cfg.engine === "scalper" ? cfg.rr : null };
        }
      }
      prevBar = b;
    }
    // Never leave a position unbooked at day-end: dropping the (usually losing) tail trade
    // silently removes it from the sample and inflates PF. Flatten at the last bar's close.
    if (pos) book(dbars[dbars.length - 1].c - slip);
    if (nTrades > 0) dayStats.push({ day, dayPnl, nWins });
  }
  const pnls = trades.map(t => t.pnl);
  const net = pnls.reduce((a, b) => a + b, 0);
  const wins = pnls.filter(p => p > 0), losses = pnls.filter(p => p <= 0);
  const pf = losses.length ? (wins.reduce((a, b) => a + b, 0) / -losses.reduce((a, b) => a + b, 0)) : (wins.length ? 99 : 0);
  return {
    symbol, trades: trades.length, days: dayStats.length, net: Math.round(net), pf: +pf.toFixed(2),
    winRate: +(wins.length / Math.max(1, trades.length) * 100).toFixed(1),
    greenDayPct: +(dayStats.filter(d => d.dayPnl > 0).length / Math.max(1, dayStats.length) * 100).toFixed(0),
  };
}
