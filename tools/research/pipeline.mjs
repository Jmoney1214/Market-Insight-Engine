// Full-pipeline PIT backtest: 8:30 ET scanner -> class badges -> badge-matched
// engine, one day at a time. Fixed $25k, 1% risk/trade, costs modeled,
// stop-before-target intrabar (pessimistic).
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const AK = process.env.ALPACA_API_KEY_ID, AS = process.env.ALPACA_API_SECRET_KEY;
const FMP = process.env.FMP_API_KEY;
const AH = { "APCA-API-KEY-ID": AK, "APCA-API-SECRET-KEY": AS };
const CACHE = new URL("./cache/", import.meta.url).pathname;
mkdirSync(CACHE, { recursive: true });

const DAYS = [
  "2026-04-13", "2026-04-14", "2026-04-15", "2026-04-16", "2026-04-17",
  "2026-05-04", "2026-05-05", "2026-05-06", "2026-05-07", "2026-05-08",
  "2025-09-03", "2025-09-04", "2025-09-05",
];
// All three windows are EDT (UTC-4): 04:00 ET = 08:00Z, 08:30 ET = 12:30Z.

const cacheGet = (k) => existsSync(`${CACHE}${k}.json`) ? JSON.parse(readFileSync(`${CACHE}${k}.json`, "utf8")) : null;
const cachePut = (k, v) => writeFileSync(`${CACHE}${k}.json`, JSON.stringify(v));

async function fmpScreener() {
  const hit = cacheGet("universe"); if (hit) return hit;
  const u = new URL("https://financialmodelingprep.com/stable/company-screener");
  Object.entries({ priceLowerThan: 150, priceMoreThan: 3, volumeMoreThan: 2000000,
    marketCapMoreThan: 500000000, exchange: "NASDAQ,NYSE", isEtf: false, isFund: false,
    limit: 500, apikey: FMP }).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u); if (!r.ok) throw new Error(`screener ${r.status}`);
  const j = await r.json();
  const out = (Array.isArray(j) ? j : []).filter((x) => /^[A-Z]{1,5}$/.test(x.symbol))
    .map((x) => ({ symbol: x.symbol, companyName: x.companyName ?? null }));
  cachePut("universe", out); return out;
}

async function fmpEarnings(from, to) {
  const k = `earn_${from}_${to}`; const hit = cacheGet(k); if (hit) return new Set(hit);
  const u = `https://financialmodelingprep.com/stable/earnings-calendar?from=${from}&to=${to}&apikey=${FMP}`;
  const r = await fetch(u); if (!r.ok) { console.error(`earnings ${from} ${r.status}`); return new Set(); }
  const j = await r.json();
  const syms = (Array.isArray(j) ? j : []).map((e) => `${e.date}|${e.symbol}`);
  cachePut(k, syms); return new Set(syms);
}

// Multi-symbol bars, chunked + paginated. Returns Map sym -> bars[]
async function multiBars(symbols, timeframe, start, end, tag) {
  const k = `mb_${tag}`; const hit = cacheGet(k);
  if (hit) return new Map(Object.entries(hit));
  const out = new Map();
  for (let i = 0; i < symbols.length; i += 100) {
    const chunk = symbols.slice(i, i + 100);
    let token;
    for (;;) {
      const u = new URL("https://data.alpaca.markets/v2/stocks/bars");
      Object.entries({ symbols: chunk.join(","), timeframe, start, end, limit: "10000",
        adjustment: "split", feed: "sip" }).forEach(([kk, v]) => u.searchParams.set(kk, v));
      if (token) u.searchParams.set("page_token", token);
      const r = await fetch(u, { headers: AH });
      if (!r.ok) { console.error(`multiBars ${tag} chunk ${i}: ${r.status}`); break; }
      const j = await r.json();
      for (const [sym, bars] of Object.entries(j.bars ?? {}))
        out.set(sym, (out.get(sym) ?? []).concat(bars));
      token = j.next_page_token; if (!token) break;
    }
  }
  cachePut(k, Object.fromEntries(out)); return out;
}

const etHm = (iso) => {
  const s = new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York",
    hour12: false, hour: "2-digit", minute: "2-digit" });
  return s.slice(0, 5);
};
const round = (n, p = 2) => Math.round(n * 10 ** p) / 10 ** p;
const clamp01 = (n) => Math.max(0, Math.min(1, n));

function classify(avgRange, dollarVol, price) {
  if (avgRange != null && avgRange >= 6.5 && price >= 20) return "rider";
  if (dollarVol != null && dollarVol >= 8e9) return "scalper";
  if (avgRange == null) return null;
  if (avgRange >= 6.5) return "caution";
  if (avgRange >= 4.5) return "caution";
  return "avoid";
}

// ---- scanner: PIT board for one day ------------------------------------------
function scanDay(day, dailiesMap, pmMap, earnSet) {
  const cands = [];
  for (const [sym, all] of dailiesMap) {
    const hist = all.filter((b) => b.t.slice(0, 10) < day);
    if (hist.length < 30) continue;
    const prevClose = hist[hist.length - 1].c;
    const pms = pmMap.get(sym) ?? [];
    const price = pms.length ? pms[pms.length - 1].c : prevClose;
    if (price > 150) continue;
    const gap = ((price - prevClose) / prevClose) * 100;
    const pmDollar = pms.reduce((s, b) => s + b.v * b.c, 0);
    const last10 = hist.slice(-10);
    const mtd = last10.filter((b) => ((b.h - b.l) / b.c) * 100 >= 2).length;
    const avgRange = last10.reduce((s, b) => s + ((b.h - b.l) / b.c) * 100, 0) / last10.length;
    const vol20 = hist.slice(-20).reduce((s, b) => s + b.v, 0) / Math.min(20, hist.length);
    const dollarVol = vol20 * prevClose;
    // ATR14 (simple TR average — matches harness precision needs)
    const tr = [];
    for (let i = Math.max(1, hist.length - 14); i < hist.length; i++)
      tr.push(Math.max(hist[i].h - hist[i].l, Math.abs(hist[i].h - hist[i - 1].c), Math.abs(hist[i].l - hist[i - 1].c)));
    const atrPct = tr.length ? (tr.reduce((a, b) => a + b, 0) / tr.length / price) * 100 : null;

    const hasEarn = earnSet.has(`${day}|${sym}`);
    const volatility = 0.55 * clamp01(mtd / 8) + 0.45 * clamp01((atrPct ?? 1.5) / 5);
    const liquidity = clamp01(Math.log10(Math.max(dollarVol, 1)) / Math.log10(5e9));
    const gapMag = clamp01(Math.abs(gap) / 5);
    const catalyst = clamp01(hasEarn ? 0.5 : 0); // news omitted in harness (see notes)
    const score = round(100 * (0.4 * volatility + 0.25 * liquidity + 0.15 * gapMag + 0.2 * catalyst), 1);
    cands.push({ sym, price: round(price), gap: round(gap), pmDollar: Math.round(pmDollar),
      mtd, avgRange: round(avgRange, 1), dollarVol: Math.round(dollarVol), atrPct: atrPct != null ? round(atrPct) : null,
      hasEarn, score, cls: classify(avgRange, dollarVol, price) });
  }
  // prelim ranking mirrors the live scan: |gap| + catalyst + liquidity
  cands.sort((a, b) => (Math.abs(b.gap) + (b.hasEarn ? 2 : 0) + clamp01(Math.log10(Math.max(b.dollarVol, 1) / 1e8)))
                     - (Math.abs(a.gap) + (a.hasEarn ? 2 : 0) + clamp01(Math.log10(Math.max(a.dollarVol, 1) / 1e8))));
  const finalists = cands.slice(0, 30);
  const jump = finalists.filter((c) => c.gap >= 1.5).sort((a, b) => b.gap - a.gap).slice(0, 12);
  const fall = finalists.filter((c) => c.gap <= -1.5).sort((a, b) => a.gap - b.gap).slice(0, 12);
  const top = [...finalists].sort((a, b) => b.score - a.score).slice(0, 12);
  const eligible = [...finalists].filter((c) => c.cls === "rider" || c.cls === "scalper")
    .sort((a, b) => b.score - a.score).slice(0, 5);
  return { day, finalists, top, jump, fall, eligible };
}

// ---- engines: one (symbol, day) ------------------------------------------------
// bars5m: full-session 5m for that day (04:00-20:00 ET). Fixed $25k, no compounding.
function runEngine(cls, dayBars, prevClose) {
  const cfg = cls === "rider"
    ? { gapUpMin: 1.5, maxTrades: 1, rr: null, entryTo: "11:00" }
    : { gapUpMin: 1.5, maxTrades: 3, rr: 1.5, entryTo: "11:00" };
  const EQ = 25000, riskPct = 1, notionalCap = 0.5, stopBuf = 0.8, commPct = 0.0002;
  const firstRth = dayBars.find((b) => b.hm >= "09:30");
  if (!firstRth) return { status: "no-data", trades: [] };
  const gap = ((firstRth.o - prevClose) / prevClose) * 100;
  if (gap <= -1.5) return { status: "declined: fall day", trades: [] };
  if (gap < cfg.gapUpMin) return { status: `declined: gap +${round(gap)}% < 1.5%`, trades: [] };
  const slip = Math.max(0.01, firstRth.o * 0.0003);
  let cumPV = 0, cumV = 0, e9 = null, e20 = null, prev = null, pos = null, pending = null;
  const trades = []; let nT = 0, dayPnl = 0;
  const ema = (p, v, n) => { const k = 2 / (n + 1); return p == null ? v : v * k + p * (1 - k); };
  for (const b of dayBars) {
    const tp = (b.h + b.l + b.c) / 3; cumPV += tp * b.v; cumV += b.v;
    const vwap = cumV > 0 ? cumPV / cumV : b.c;
    e9 = ema(e9, b.c, 9); e20 = ema(e20, b.c, 20);
    const rth = b.hm >= "09:30" && b.hm < "16:00";
    if (pending && rth) {
      const entry = b.o + slip, stopDist = entry - pending.stop;
      if (stopDist > 0) {
        const qty = Math.floor(Math.min((EQ * riskPct / 100) / stopDist, (EQ * notionalCap) / entry));
        if (qty >= 1) pos = { entry, entryHm: b.hm, stop: pending.stop,
          tgt: cfg.rr ? entry + stopDist * cfg.rr : Infinity, qty };
      }
      pending = null;
    }
    if (pos && rth) {
      let exit = null, reason = null;
      if (b.l <= pos.stop) { exit = pos.stop - slip; reason = "stop"; }
      else if (b.h >= pos.tgt) { exit = pos.tgt; reason = "target"; }
      else if (b.hm >= "15:50") { exit = b.c; reason = "eod"; }
      if (exit != null) {
        const pnl = (exit - pos.entry) * pos.qty - (pos.entry + exit) * pos.qty * commPct;
        dayPnl += pnl; nT++;
        trades.push({ entryHm: pos.entryHm, exitHm: b.hm, entry: round(pos.entry), exit: round(exit),
          qty: pos.qty, pnl: round(pnl), reason });
        pos = null;
      }
    }
    const canSignal = rth && b.hm >= "09:40" && b.hm <= cfg.entryTo && !pos && !pending &&
      nT < cfg.maxTrades && dayPnl > -500;
    if (canSignal && prev) {
      const tag = b.l <= e9 && b.c > e9 && b.c > vwap && e9 > e20;
      if (tag) pending = { stop: Math.min(b.l, prev.l) - (stopBuf / 100) * b.c };
    }
    prev = b;
  }
  return { status: trades.length ? "traded" : "qualified, no trigger", gap: round(gap), trades };
}

// ---- main ------------------------------------------------------------------------
const uni = await fmpScreener();
console.error(`universe: ${uni.length}`);
const syms = uni.map((u) => u.symbol);
const nameOf = new Map(uni.map((u) => [u.symbol, u.companyName]));
const dailies = await multiBars(syms, "1Day", "2025-05-01T00:00:00Z", "2026-07-02T23:59:00Z", "dailies_all");
console.error(`dailies: ${dailies.size} symbols`);
const earnSet = new Set([
  ...(await fmpEarnings("2026-04-13", "2026-04-17")),
  ...(await fmpEarnings("2026-05-04", "2026-05-08")),
  ...(await fmpEarnings("2025-09-03", "2025-09-05")),
]);

const results = [];
for (const day of DAYS) {
  const pm = await multiBars(syms, "5Min", `${day}T08:00:00Z`, `${day}T12:30:00Z`, `pm_${day}`);
  const board = scanDay(day, dailies, pm, earnSet);
  // engines need the full session for the selected few
  const picks = [];
  for (const c of board.eligible) {
    const full = await multiBars([c.sym], "5Min", `${day}T08:00:00Z`, `${day}T23:59:00Z`, `full_${day}_${c.sym}`);
    const dayBars = (full.get(c.sym) ?? []).map((b) => ({ ...b, hm: etHm(b.t) }));
    const hist = dailies.get(c.sym).filter((b) => b.t.slice(0, 10) < day);
    const res = runEngine(c.cls, dayBars, hist[hist.length - 1].c);
    picks.push({ ...c, companyName: nameOf.get(c.sym), engine: c.cls, ...res });
  }
  results.push({ day, universeSize: dailies.size,
    board: { top: board.top, jump: board.jump, fall: board.fall }, picks });
  const traded = picks.filter((p) => p.trades.length);
  const pnl = traded.flatMap((p) => p.trades).reduce((s, t) => s + t.pnl, 0);
  console.error(`${day}: eligible=${picks.length} traded=${traded.length} dayPnl=${round(pnl)}`);
}
writeFileSync(new URL("./pipeline_results.json", import.meta.url).pathname, JSON.stringify(results, null, 1));
console.error("done -> pipeline_results.json");
