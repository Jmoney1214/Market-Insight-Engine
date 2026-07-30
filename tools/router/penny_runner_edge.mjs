// Does the RUNNER SETUP have edge? Any long bot on sub-$10 runners depends on one
// base rate: when a cheap stock is up >=20% intraday, does it CONTINUE or FADE?
// Measure it across every sub-$10 runner-day over a long window, net of realistic cost.
// This isolates the QUESTION the Bj Bot rides on — no protected code needed.
//   node --env-file=.env tools/router/penny_runner_edge.mjs [--from=2025-10-01] [--pct=20]
import { alpacaBars } from "../research/lib/data.mjs";

const FMP = process.env.FMP_API_KEY;
if (!process.env.ALPACA_API_KEY_ID || !process.env.ALPACA_API_SECRET_KEY) throw new Error("missing ALPACA creds");
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const FROM = arg("from", "2025-10-01"), TO = "2026-07-28";
const TRIG = arg("trigger", "gap");             // gap = knowable at open (honest); high = look-ahead (contrast only)
const RUN_PCT = Number(arg("pct", 20)) / 100;   // trigger threshold above prior close = "was a runner"
const MINP = 0.30, MAXP = 10, MIN_DVOL = 20e6;  // tradeable band + $-volume floor
const COST = 0.005;                             // 0.5% round-trip haircut (spread+comm) for a sub-$10 long

// sub-$10 universe (no volume filter — a name normally dead can still pop; the per-day
// $-vol floor selects the tradeable runner-days). Actively-trading NASDAQ/NYSE/AMEX.
const u = new URL("https://financialmodelingprep.com/stable/company-screener");
Object.entries({ priceLowerThan: MAXP, priceMoreThan: MINP, exchange: "NASDAQ,NYSE,AMEX",
  isEtf: false, isFund: false, isActivelyTrading: true, limit: 5000, apikey: FMP })
  .forEach(([k, v]) => u.searchParams.set(k, v));
const r = await fetch(u);
if (!r.ok) throw new Error(`FMP screener ${r.status}`);
const syms = (await r.json()).filter((x) => /^[A-Z]{1,5}$/.test(x.symbol)).map((x) => x.symbol);
console.log(`\n=== RUNNER SETUP EDGE · ${FROM}..${TO} · sub-$${MAXP}, ${TRIG === "high" ? "intraday-high" : "OPEN-GAP"} >=${(RUN_PCT * 100).toFixed(0)}% vs prior close${TRIG === "high" ? " (LOOK-AHEAD)" : " (knowable at open)"}, $-vol >= $${MIN_DVOL / 1e6}M ===`);
console.log(`universe: ${syms.length} sub-$${MAXP} names · pulling daily bars...\n`);

const bars = await alpacaBars(syms, "1Day", FROM, TO, "runner_edge", 24);
const sortB = (raw) => [...raw].sort((a, b) => (a.t < b.t ? -1 : 1));

const runs = [];
for (const s of syms) {
  const raw = bars.get(s); if (!raw || raw.length < 3) continue;
  const b = sortB(raw);
  for (let i = 1; i < b.length; i++) {
    const prev = b[i - 1].c, d = b[i];
    if (!(prev > 0) || !(d.o > 0)) continue;
    if (d.c < MINP || d.c > MAXP) continue;
    // TRIGGER must be knowable AT ENTRY. gap (default) = open vs prior close, known at
    // the open → a clean "buy the gap-up at the open" test. high = intraday high, which
    // is LOOK-AHEAD (you can't know the day's high at the open) — kept only for contrast.
    const ranHigh = (d.h - prev) / prev, gap = (d.o - prev) / prev;
    const trig = TRIG === "high" ? ranHigh : gap;
    if (trig < RUN_PCT) continue;
    const dvol = d.c * (d.v || 0);
    if (dvol < MIN_DVOL) continue;                   // tradeable liquidity that day
    const next = i + 1 < b.length ? (b[i + 1].c - d.c) / d.c : null;
    runs.push({
      s, date: d.t.slice(0, 10),
      gap: (d.o - prev) / prev,          // overnight gap
      ranHigh,                            // how far it ran off prior close
      o2c: (d.c - d.o) / d.o,            // OPEN->CLOSE = a same-day long's raw P&L
      dayRet: (d.c - prev) / prev,       // prior close -> close
      next,                               // next-day close-to-close
    });
  }
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const pctPos = (a) => 100 * a.filter((x) => x > 0).length / a.length;
const pf = (n) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(2)}%`;

const names = new Set(runs.map((r) => r.s)).size;
const o2c = runs.map((r) => r.o2c);
const o2cNet = o2c.map((x) => x - COST);
const nexts = runs.filter((r) => r.next != null).map((r) => r.next);
const winners = o2c.filter((x) => x > 0), losers = o2c.filter((x) => x <= 0);
const grossPF = Math.abs(losers.reduce((s, x) => s + x, 0)) > 0
  ? winners.reduce((s, x) => s + x, 0) / Math.abs(losers.reduce((s, x) => s + x, 0)) : Infinity;

console.log(`RUNNER-DAYS: ${runs.length}  across ${names} distinct names\n`);
console.log(`── If you went LONG the runner at the OPEN and exited at the CLOSE (the bot's core bet):`);
console.log(`   avg  ${pf(mean(o2c)).padStart(8)}   median ${pf(median(o2c)).padStart(8)}   green ${pctPos(o2c).toFixed(0)}%   profit factor ${grossPF.toFixed(2)}`);
console.log(`   NET of ${(COST * 100).toFixed(1)}% round-trip cost: avg ${pf(mean(o2cNet)).padStart(8)}   green ${pctPos(o2cNet).toFixed(0)}%`);
console.log(`\n── Prior-close -> close (full-day hold):  avg ${pf(mean(runs.map((r) => r.dayRet)))}   green ${pctPos(runs.map((r) => r.dayRet)).toFixed(0)}%`);
console.log(`── Next-day (close -> next close, overnight hold): avg ${pf(mean(nexts))}   green ${pctPos(nexts).toFixed(0)}%   (n=${nexts.length})`);

// bucket by how hard it ran that day — do the biggest runners fade hardest?
console.log(`\n── OPEN->CLOSE by how far it ran off prior close:`);
for (const [lo, hi] of [[0.20, 0.35], [0.35, 0.60], [0.60, 1.0], [1.0, 99]]) {
  const g = runs.filter((r) => r.ranHigh >= lo && r.ranHigh < hi).map((r) => r.o2c);
  if (g.length) console.log(`   ran +${(lo * 100).toFixed(0)}${hi < 99 ? "-" + (hi * 100).toFixed(0) : "+"}%  (n=${String(g.length).padStart(4)}):  avg ${pf(mean(g)).padStart(8)}  green ${pctPos(g).toFixed(0)}%`);
}
console.log("");
