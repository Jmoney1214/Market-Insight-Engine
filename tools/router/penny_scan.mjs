// Sub-$10 RUNNER SCANNER — finds low-priced names igniting intraday, the KIDZ-type
// setups the Penny Runner Scalper Pine trades. Two stages:
//   1) shortlist today's sub-$10 gainers (FMP biggest-gainers; falls back to the
//      company-screener + Alpaca daily %-change if that endpoint is plan-gated).
//   2) for each, pull Alpaca SIP 5-min and grade the LIVE ignition state — above/below
//      VWAP, RVOL, position in the session range — so you can tell a FRESH ignition
//      from an already-EXTENDED chase or a dead FADE.
// Read-only, zero contact with the TradingView chart. No validated edge yet — paper.
//   node --env-file=.env tools/router/penny_scan.mjs [--min=0.3] [--max=10] [--pct=15]
import { alpacaBars } from "../research/lib/data.mjs";

const FMP = process.env.FMP_API_KEY;
if (!process.env.ALPACA_API_KEY_ID || !process.env.ALPACA_API_SECRET_KEY) throw new Error("missing ALPACA creds");

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? Number(a.split("=")[1]) : d; };
const MIN_PRICE = arg("min", 0.30), MAX_PRICE = arg("max", 10), RUNNER_PCT = arg("pct", 20); // ≥20% up on the day — matches the Pine's minDayChg arm gate
const MIN_DVOL = arg("dvol", 20) * 1e6;   // $-volume floor — below this you ARE the order book (untradeable)

const etDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const DAY = etDate();
const OPEN_UTC = `${DAY}T13:30:00Z`;   // 9:30 ET (EDT); wrong by 1h in EST but only shifts the open cut
const NOW_UTC = new Date().toISOString();
const num = (v) => { const n = parseFloat(String(v).replace("%", "")); return Number.isFinite(n) ? n : null; };

// ---- Stage 1: today's sub-$10 gainer shortlist -----------------------------
async function fmpGainers() {
  for (const url of [
    "https://financialmodelingprep.com/stable/biggest-gainers",
    "https://financialmodelingprep.com/api/v3/stock_market/gainers",
  ]) {
    try {
      const r = await fetch(`${url}?apikey=${FMP}`);
      if (!r.ok) continue;
      const j = await r.json();
      if (Array.isArray(j) && j.length) return j.map((x) => ({ symbol: x.symbol, price: num(x.price), pct: num(x.changesPercentage), name: x.name ?? x.companyName ?? "", exchange: x.exchange ?? "" }));
    } catch { /* try next */ }
  }
  return null;
}

// Fallback: screener sub-$10 universe, then compute today's %-change from Alpaca daily.
async function screenerRunners() {
  const u = new URL("https://financialmodelingprep.com/stable/company-screener");
  Object.entries({ priceLowerThan: MAX_PRICE, priceMoreThan: MIN_PRICE, volumeMoreThan: 1000000,
    exchange: "NASDAQ,NYSE,AMEX", isEtf: false, isFund: false, isActivelyTrading: true, limit: 3000, apikey: FMP })
    .forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u);
  if (!r.ok) throw new Error(`FMP screener ${r.status}`);
  const syms = (await r.json()).filter((x) => /^[A-Z]{1,5}$/.test(x.symbol)).map((x) => x.symbol);
  const daily = await alpacaBars(syms, "1Day", "2026-06-01", "2026-07-28", "penny_fallback_daily", 6);
  const sortB = (raw) => [...raw].sort((a, b) => (a.t < b.t ? -1 : 1));
  const out = [];
  for (const s of syms) {
    const d = sortB(daily.get(s) || []);
    const di = d.findIndex((x) => x.t.slice(0, 10) === DAY);
    if (di < 1) continue;
    const pct = (d[di].c - d[di - 1].c) / d[di - 1].c * 100;
    if (pct >= RUNNER_PCT) out.push({ symbol: s, price: d[di].c, pct, name: "", exchange: "" });
  }
  return out;
}

let runners = await fmpGainers();
let src = "FMP biggest-gainers";
if (!runners) { runners = await screenerRunners(); src = "FMP screener + Alpaca daily (gainers endpoint gated)"; }
runners = runners
  .filter((x) => x.price != null && x.pct != null && x.price >= MIN_PRICE && x.price <= MAX_PRICE && x.pct >= RUNNER_PCT)
  .filter((x) => /^[A-Z]{1,5}$/.test(x.symbol))
  .sort((a, b) => b.pct - a.pct)
  .slice(0, 30);

console.log(`\n=== SUB-$${MAX_PRICE} RUNNER SCAN · ${DAY} @ ${NOW_UTC.slice(11, 16)}Z · src: ${src} ===`);
console.log(`filters: $${MIN_PRICE}–$${MAX_PRICE}, up ≥ ${RUNNER_PCT}% today, tradeable ≥ $${(MIN_DVOL / 1e6).toFixed(0)}M $-vol · ${runners.length} candidate(s)\n`);
if (!runners.length) { console.log("no sub-$10 runners clearing the filter right now.\n"); process.exit(0); }

// ---- Stage 2: live intraday ignition grade ---------------------------------
const syms = runners.map((r) => r.symbol);
const intr = await alpacaBars(syms, "5Min", DAY, "2026-07-28", "penny_intraday", 0.05);
const daily = await alpacaBars(syms, "1Day", "2026-06-01", "2026-07-28", "penny_daily", 6);
const sortB = (raw) => [...raw].sort((a, b) => (a.t < b.t ? -1 : 1));

const graded = [], tooThin = [];
for (const r of runners) {
  const raw = intr.get(r.symbol), draw = daily.get(r.symbol);
  if (!raw || !draw) continue;
  const day = sortB(raw).filter((x) => x.t >= OPEN_UTC && x.t <= NOW_UTC);
  if (day.length < 3) continue;
  const d = sortB(draw); const di = d.findIndex((x) => x.t.slice(0, 10) === DAY);
  const vol20 = di >= 20 ? d.slice(di - 20, di).reduce((s, x) => s + (x.v || 0), 0) / 20 : null;
  let pv = 0, vv = 0; for (const x of day) { pv += (x.h + x.l + x.c) / 3 * x.v; vv += x.v; }
  const vwap = vv > 0 ? pv / vv : null;
  const now = day[day.length - 1].c;
  const cumVol = day.reduce((s, x) => s + (x.v || 0), 0);
  const dollarVol = now * cumVol;
  // HARD liquidity gate: below the $-volume floor you ARE the order book — drop it,
  // but log what was dropped (no silent truncation).
  if (dollarVol < MIN_DVOL) { tooThin.push({ symbol: r.symbol, dollarVol }); continue; }
  const hi = Math.max(...day.map((x) => x.h)), lo = Math.min(...day.map((x) => x.l));
  const pos = hi > lo ? (now - lo) / (hi - lo) : 0.5;
  const aboveV = vwap != null && now > vwap;
  // RVOL is only meaningful when the name's NORMAL volume isn't ~zero; on names that
  // are usually dead it legitimately blows past 50x. So we CAP the display and never
  // rank or gate on it — VWAP side, rangePos and $-vol are the trustworthy signals.
  const rvolRaw = vol20 ? cumVol / (0.42 * vol20) : null;
  const rvol = rvolRaw == null ? null : Math.min(rvolRaw, 50);
  const rvolCapped = rvolRaw != null && rvolRaw > 50;
  let grade;
  if (!aboveV) grade = "FADED (below VWAP — missed/avoid)";
  else if (pos >= 0.97 && r.pct >= 40) grade = "EXTENDED (chase risk)";
  else if (pos >= 0.7) grade = "IGNITING (fresh)";
  else grade = "above VWAP (watch)";
  graded.push({ ...r, now, vwap, aboveV, pos, rvol, rvolCapped, dollarVol, grade });
}

const rank = { "IGNITING (fresh)": 0, "above VWAP (watch)": 1, "EXTENDED (chase risk)": 2, "FADED (below VWAP — missed/avoid)": 3 };
// tie-break on $-volume (most tradeable first), NOT on the noisy RVOL
graded.sort((a, b) => (rank[a.grade] - rank[b.grade]) || (b.dollarVol - a.dollarVol));

const pct = (x) => (x == null ? "  -  " : `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`);
const rvolFmt = (g) => g.rvol == null ? "n/a" : `${g.rvol.toFixed(0)}${g.rvolCapped ? "+" : ""}x`;
for (const g of graded) {
  console.log(`  ${g.symbol.padEnd(6)} $${g.now.toFixed(2).padStart(7)}  day ${pct(g.pct).padStart(7)}  VWAP ${g.aboveV ? "▲" : "▼"} $${(g.vwap ?? 0).toFixed(2)}  rangePos ${(g.pos * 100).toFixed(0).padStart(3)}%  RVOL ${rvolFmt(g).padStart(5)}  $vol ${(g.dollarVol / 1e6).toFixed(0).padStart(4)}M   ${g.grade}`);
}
if (tooThin.length) console.log(`\n  dropped ${tooThin.length} below $${(MIN_DVOL / 1e6).toFixed(0)}M $-vol (untradeable): ${tooThin.sort((a, b) => b.dollarVol - a.dollarVol).map((t) => `${t.symbol} $${(t.dollarVol / 1e6).toFixed(1)}M`).join(", ")}`);
if (!graded.length) { console.log(`\nno tradeable sub-$${MAX_PRICE} runners above the $${(MIN_DVOL / 1e6).toFixed(0)}M liquidity floor right now.\n`); process.exit(0); }
const best = graded.find((g) => g.grade === "IGNITING (fresh)");
console.log(best
  ? `\n>> Freshest ignition: ${best.symbol} $${best.now.toFixed(2)} — above VWAP $${best.vwap.toFixed(2)}, RVOL ${best.rvol.toFixed(1)}x, ${(best.pos * 100).toFixed(0)}% of range. VWAP is the stop.\n`
  : `\n>> No FRESH ignition right now — the runners are either extended or already faded below VWAP. Stand aside.\n`);
