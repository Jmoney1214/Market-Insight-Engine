// LONG-ONLY tests of the two remaining setups from the spec, on the same sub-$10
// runner universe, same rigor (no look-ahead, realistic cost), comparable exits
// (setup hard-stop OR VWAP loss OR EOD):
//   ORB_LONG      = break of the first-15-min opening-range HIGH; stop = OR low.
//   FIRST_PULLBACK= after an up-leg, first pullback BELOW EMA9 then RECLAIM; stop = pullback low.
//   node --env-file=.env tools/router/penny_setups.mjs --setup=orb|pullback
import { alpacaBars } from "../research/lib/data.mjs";
import { UNIVERSE } from "./config.mjs";

const FMP = process.env.FMP_API_KEY;
if (!process.env.ALPACA_API_KEY_ID || !process.env.ALPACA_API_SECRET_KEY) throw new Error("missing ALPACA creds");
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const FROM = arg("from", "2026-04-01"), TO = "2026-07-28", SETUP = arg("setup", "orb"), UNIV = arg("universe", "penny");
const GAP = Number(arg("pct", 20)) / 100, MINP = Number(arg("min", 0.30)), MAXP = Number(arg("max", 10)), MIN_DVOL = Number(arg("dvol", 20)) * 1e6, COST = 0.005;
const ORB_BARS = 3, EMA_LEN = 9, WARMUP = 3;   // ORB = first 15 min (3x5m); EMA9 pullback line

let syms;
if (UNIV === "router") syms = UNIVERSE;                     // 87 liquid large-caps
else {
  const u = new URL("https://financialmodelingprep.com/stable/company-screener");
  Object.entries({ priceLowerThan: MAXP, priceMoreThan: MINP, exchange: "NASDAQ,NYSE,AMEX",
    isEtf: false, isFund: false, isActivelyTrading: true, limit: 5000, apikey: FMP })
    .forEach(([k, v]) => u.searchParams.set(k, v));
  const rr = await fetch(u); if (!rr.ok) throw new Error(`FMP screener ${rr.status}`);
  syms = (await rr.json()).filter((x) => /^[A-Z]{1,5}$/.test(x.symbol)).map((x) => x.symbol);
}
const sortB = (raw) => [...raw].sort((a, b) => (a.t < b.t ? -1 : 1));

console.log(`\n=== ${SETUP.toUpperCase()} (LONG-ONLY) · ${UNIV} · ${FROM}..${TO} · $${MINP}-$${MAXP}, gap>=${GAP * 100}%, $vol>=$${MIN_DVOL / 1e6}M · exit: stop|VWAP-loss|EOD ===`);
const daily = await alpacaBars(syms, "1Day", FROM, TO, `set_${UNIV}_1d`, 24);
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
console.log(`${runnerDays.length} gap-runner days across ${names.length} names · pulling 5-min...\n`);
const intr = await alpacaBars(names, "5Min", FROM, TO, `set_${UNIV}_5m`, 24);

function trade(day) {
  const n = day.length;
  const vwap = new Array(n); { let pv = 0, vv = 0; for (let i = 0; i < n; i++) { pv += (day[i].h + day[i].l + day[i].c) / 3 * day[i].v; vv += day[i].v; vwap[i] = vv > 0 ? pv / vv : day[i].c; } }
  const ema = new Array(n); { const k = 2 / (EMA_LEN + 1); let e = day[0].c; for (let i = 0; i < n; i++) { e = i === 0 ? day[0].c : day[i].c * k + e * (1 - k); ema[i] = e; } }

  let entryIdx = -1, hardStop = -Infinity;
  if (SETUP === "orb") {
    const orbHigh = Math.max(...day.slice(0, ORB_BARS).map((x) => x.h));
    const orbLow = Math.min(...day.slice(0, ORB_BARS).map((x) => x.l));
    for (let i = ORB_BARS; i < n - 1; i++) { if (day[i].h > orbHigh) { entryIdx = i + 1; break; } }
    hardStop = orbLow;
  } else { // pullback: up-leg (above EMA9) -> dip below EMA9 -> reclaim
    let aboveOnce = false, pulled = false, pbLow = Infinity;
    for (let i = WARMUP; i < n - 1; i++) {
      if (day[i].c > ema[i]) { aboveOnce = true; if (pulled) { entryIdx = i + 1; hardStop = pbLow; break; } }
      else if (aboveOnce) { pulled = true; pbLow = Math.min(pbLow, day[i].l); }
    }
  }
  if (entryIdx < 0 || entryIdx >= n) return null;                 // no setup -> stand aside
  const entry = day[entryIdx].o;
  for (let j = entryIdx; j < n; j++) {
    if (day[j].l < hardStop) return (hardStop - entry) / entry - COST;               // hard stop
    if (day[j].c < vwap[j]) { const ex = j + 1 < n ? day[j + 1].o : day[j].c; return (ex - entry) / entry - COST; } // VWAP loss
  }
  return (day[n - 1].c - entry) / entry - COST;                   // EOD
}

const rets = [], tradedList = [];
for (const rd of runnerDays) {
  const raw = intr.get(rd.s); if (!raw) continue;
  const OPEN = `${rd.date}T13:30:00Z`, CLOSE = `${rd.date}T20:00:00Z`;
  const day = sortB(raw).filter((x) => x.t >= OPEN && x.t <= CLOSE);
  if (day.length < ORB_BARS + 4) continue;
  const r = trade(day);
  rets.push(r == null ? 0 : r);
  if (r != null) tradedList.push(r);
}

const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const pf = (n) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(2)}%`;
console.log(`OPPORTUNITIES: ${rets.length}  ·  fired on ${tradedList.length}  ·  stood aside ${rets.length - tradedList.length}  (${(100 * tradedList.length / rets.length).toFixed(0)}% participation)\n`);
if (tradedList.length) {
  const w = tradedList.filter((x) => x > 0), l = tradedList.filter((x) => x <= 0);
  const PF = Math.abs(l.reduce((s, x) => s + x, 0)) > 0 ? w.reduce((s, x) => s + x, 0) / Math.abs(l.reduce((s, x) => s + x, 0)) : Infinity;
  console.log(`── When it fired:  avg ${pf(mean(tradedList))}   median ${pf(median(tradedList))}   green ${(100 * w.length / tradedList.length).toFixed(0)}%   PF ${PF.toFixed(2)}`);
}
console.log(`── Per OPPORTUNITY (stand-aside = 0):  avg ${pf(mean(rets))}   vs blind −2.32% · VWAP-hold −1.68% · IGNITE −0.65%`);
console.log(`\n(net of ${COST * 100}% round-trip cost; sub-$10 fills optimistic → upper bound)\n`);
