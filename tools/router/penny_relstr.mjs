// TEST 2 — cross-sectional RELATIVE STRENGTH selection on top of the (breakeven)
// VWAP-hold scaffolding. For each DAY's $5-15 runners, take the same VWAP-hold long
// but rank the names by intraday momentum INTO the entry (open->signal-bar return —
// knowable at entry; vs SPY is the same ranking within a day). Question: do the
// STRONGEST names beat the WEAKEST / the all-average? That would be a real added edge.
//   node --env-file=.env tools/router/penny_relstr.mjs [--from --to --min --max --pct]
import { alpacaBars } from "../research/lib/data.mjs";

const FMP = process.env.FMP_API_KEY;
if (!process.env.ALPACA_API_KEY_ID || !process.env.ALPACA_API_SECRET_KEY) throw new Error("missing ALPACA creds");
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const FROM = arg("from", "2026-04-01"), TO = arg("to", "2026-07-28");
const GAP = Number(arg("pct", 5)) / 100, MINP = Number(arg("min", 5)), MAXP = Number(arg("max", 15)), MIN_DVOL = Number(arg("dvol", 20)) * 1e6, COST = Number(arg("cost", 0.5)) / 100, WARMUP = 3;

const u = new URL("https://financialmodelingprep.com/stable/company-screener");
Object.entries({ priceLowerThan: MAXP, priceMoreThan: MINP, exchange: "NASDAQ,NYSE,AMEX",
  isEtf: false, isFund: false, isActivelyTrading: true, limit: 5000, apikey: FMP })
  .forEach(([k, v]) => u.searchParams.set(k, v));
const rr = await fetch(u); if (!rr.ok) throw new Error(`FMP screener ${rr.status}`);
const syms = (await rr.json()).filter((x) => /^[A-Z]{1,5}$/.test(x.symbol)).map((x) => x.symbol);
const sortB = (raw) => [...raw].sort((a, b) => (a.t < b.t ? -1 : 1));

console.log(`\n=== TEST 2: RELATIVE-STRENGTH SELECTION · $${MINP}-$${MAXP} runners (gap>=${GAP * 100}%) · ${FROM}..${TO} ===`);
const daily = await alpacaBars(syms, "1Day", FROM, TO, "set_penny_1d", 24);
const runnerDays = [];
for (const s of syms) {
  const raw = daily.get(s); if (!raw || raw.length < 2) continue;
  const b = sortB(raw);
  for (let i = 1; i < b.length; i++) {
    const prev = b[i - 1].c, d = b[i];
    if (!(prev > 0) || d.c < MINP || d.c > MAXP) continue;
    if ((d.o - prev) / prev < GAP) continue;
    if (d.c * (d.v || 0) < MIN_DVOL) continue;
    runnerDays.push({ s, date: d.t.slice(0, 10) });
  }
}
const names = [...new Set(runnerDays.map((r) => r.s))];
console.log(`${runnerDays.length} runner-days across ${names.length} names · pulling 5-min...\n`);
const intr = await alpacaBars(names, "5Min", FROM, TO, "set_penny_5m", 24);

// VWAP-hold (loose exit) + strength = open->signal-bar return (intraday momentum into entry)
function tradeWithStrength(day) {
  const n = day.length, vwap = new Array(n);
  let pv = 0, vv = 0; for (let i = 0; i < n; i++) { pv += (day[i].h + day[i].l + day[i].c) / 3 * day[i].v; vv += day[i].v; vwap[i] = vv > 0 ? pv / vv : day[i].c; }
  let entryIdx = -1;
  for (let i = WARMUP; i < n - 1; i++) { if (day[i].c > vwap[i] && day[i - 1].c > vwap[i - 1]) { entryIdx = i + 1; break; } }
  if (entryIdx < 0 || entryIdx >= n) return null;
  const strength = (day[entryIdx - 1].c - day[0].o) / day[0].o;      // momentum into the entry (no look-ahead)
  const entry = day[entryIdx].o;
  for (let j = entryIdx; j < n; j++) {
    if (day[j].c < vwap[j] && day[j - 1].c < vwap[j - 1]) { const ex = j + 1 < n ? day[j + 1].o : day[j].c; return { ret: (ex - entry) / entry - COST, strength }; }
  }
  return { ret: (day[n - 1].c - entry) / entry - COST, strength };
}

const byDate = new Map();
for (const rd of runnerDays) {
  const raw = intr.get(rd.s); if (!raw) continue;
  const OPEN = `${rd.date}T13:30:00Z`, CLOSE = `${rd.date}T20:00:00Z`;
  const day = sortB(raw).filter((x) => x.t >= OPEN && x.t <= CLOSE);
  if (day.length < WARMUP + 3) continue;
  const t = tradeWithStrength(day);
  if (!t) continue;
  if (!byDate.has(rd.date)) byDate.set(rd.date, []);
  byDate.get(rd.date).push({ sym: rd.s, ...t });
}

// within each date rank by strength desc, bucket
const buckets = { top1: [], top3: [], rest: [], strongHalf: [], weakHalf: [], all: [] };
const byRankN = new Map();
let daysUsed = 0;
for (const [, arr] of byDate) {
  if (arr.length < 2) { arr.forEach((x) => { buckets.all.push(x.ret); }); continue; } // need >=2 to rank
  daysUsed++;
  arr.sort((a, b) => b.strength - a.strength);
  const M = arr.length;
  arr.forEach((x, k) => {
    buckets.all.push(x.ret);
    if (k === 0) buckets.top1.push(x.ret);
    if (k < 3) buckets.top3.push(x.ret); else buckets.rest.push(x.ret);
    if (k < M / 2) buckets.strongHalf.push(x.ret); else buckets.weakHalf.push(x.ret);
    const r = Math.min(k + 1, 4); if (!byRankN.has(r)) byRankN.set(r, []); byRankN.get(r).push(x.ret);
  });
}

const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const pctPos = (a) => a.length ? 100 * a.filter((x) => x > 0).length / a.length : 0;
const pf = (n) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(2)}%`;
const row = (name, a) => `  ${name.padEnd(24)} n=${String(a.length).padStart(4)}   avg ${pf(mean(a)).padStart(8)}   green ${pctPos(a).toFixed(0)}%`;
console.log(`multi-runner days used for ranking: ${daysUsed}\n`);
console.log("── EV by relative-strength cohort (within-day rank):");
console.log(row("STRONGEST (rank 1/day)", buckets.top1));
console.log(row("top-3 strongest", buckets.top3));
console.log(row("the rest (rank 4+)", buckets.rest));
console.log(row("strong half", buckets.strongHalf));
console.log(row("weak half", buckets.weakHalf));
console.log(row("ALL runners (baseline)", buckets.all));
console.log("\n── by exact rank:");
for (const r of [1, 2, 3, 4]) if (byRankN.has(r)) console.log(row(r === 4 ? "rank 4+" : `rank ${r}`, byRankN.get(r)));
console.log("");
