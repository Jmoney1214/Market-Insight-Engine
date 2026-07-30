// Overnight WATCHLIST for a $15-and-below long-only trader: liquid names already
// trending / near recent highs = the candidate pool tomorrow's runners come from.
// NOT a validated signal — a curated pool to watch live at the open. Long-only.
//   node --env-file=.env tools/router/sub15_watch.mjs [--min=2 --max=15]
import { alpacaBars } from "../research/lib/data.mjs";

const FMP = process.env.FMP_API_KEY;
if (!process.env.ALPACA_API_KEY_ID || !process.env.ALPACA_API_SECRET_KEY) throw new Error("missing ALPACA creds");
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const MINP = Number(arg("min", 2)), MAXP = Number(arg("max", 15)), MIN_DVOL = Number(arg("dvol", 20)) * 1e6;
const FROM = "2026-06-05", TO = "2026-07-29";

const u = new URL("https://financialmodelingprep.com/stable/company-screener");
Object.entries({ priceLowerThan: MAXP, priceMoreThan: MINP, volumeMoreThan: 1000000,
  exchange: "NASDAQ,NYSE,AMEX", isEtf: false, isFund: false, isActivelyTrading: true, limit: 5000, apikey: FMP })
  .forEach(([k, v]) => u.searchParams.set(k, v));
const rr = await fetch(u); if (!rr.ok) throw new Error(`FMP screener ${rr.status}`);
const syms = (await rr.json()).filter((x) => /^[A-Z]{1,5}$/.test(x.symbol)).map((x) => x.symbol);
console.log(`\n=== $${MINP}-$${MAXP} WATCHLIST (long-only, momentum leaders) · as of last close ===`);
console.log(`screening ${syms.length} names for liquidity + trend...\n`);
const daily = await alpacaBars(syms, "1Day", FROM, TO, "sub15_watch", 12);
const sortB = (raw) => [...raw].sort((a, b) => (a.t < b.t ? -1 : 1));

const rows = [];
for (const s of syms) {
  const raw = daily.get(s); if (!raw || raw.length < 22) continue;
  const b = sortB(raw); const n = b.length, d = b[n - 1];
  if (d.c < MINP || d.c > MAXP) continue;
  const avgVol20 = b.slice(n - 20).reduce((x, y) => x + (y.v || 0), 0) / 20;
  const dvol = d.c * avgVol20;
  if (dvol < MIN_DVOL) continue;
  const hi20 = Math.max(...b.slice(n - 20).map((x) => x.h));
  const vsHigh = (d.c - hi20) / hi20;              // 0 = at 20d high
  const ret5 = (d.c - b[n - 6].c) / b[n - 6].c;
  const ret1 = (d.c - b[n - 2].c) / b[n - 2].c;
  const atrPct = (() => { let s = 0; for (let i = n - 14; i < n; i++) s += Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c)); return (s / 14) / d.c; })();
  rows.push({ s, close: d.c, vsHigh, ret5, ret1, dvol, atrPct });
}
// leaders: near the 20d high (within 4%) AND positive 5-day momentum; rank by 5d momentum
const leaders = rows.filter((r) => r.vsHigh >= -0.04 && r.ret5 > 0).sort((a, b) => b.ret5 - a.ret5).slice(0, 18);
const pct = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
console.log(`  ${"sym".padEnd(6)} ${"price".padStart(7)}  ${"5d".padStart(7)}  ${"1d".padStart(7)}  ${"vs20dHi".padStart(8)}  ${"ATR%".padStart(5)}  ${"$vol".padStart(6)}`);
for (const r of leaders)
  console.log(`  ${r.s.padEnd(6)} ${("$" + r.close.toFixed(2)).padStart(7)}  ${pct(r.ret5).padStart(7)}  ${pct(r.ret1).padStart(7)}  ${pct(r.vsHigh).padStart(8)}  ${(r.atrPct * 100).toFixed(1).padStart(4)}%  ${(r.dvol / 1e6).toFixed(0).padStart(4)}M`);
console.log(`\n${leaders.length} liquid $${MINP}-$${MAXP} leaders (near 20d high + up on the week). Watch these at the open; take the STRONGEST intraday on a VWAP reclaim-hold. Paper.\n`);
